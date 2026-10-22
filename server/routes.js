// PASTE AS: server/routes.js  Day 11: a disabled doctor cannot log in, use an old login, go online or be requested. Day 9: new-request and payment alerts. (replaces the old file)  Day 8: owner-only downloads with logged refusals, two-layer integrity check on download and verify, safe rebuild of a missing PDF. Day 6: busy doctors put patients in a waiting queue. Day 4: secret from security.js, login rate limiting, audit log entries.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const { uid } = db;
const activity = require('./activity');
const pdf = require('./pdf');
const queue = require('./queue');
const notify = require('./notify');

const { JWT_SECRET: SECRET, clientIp, loginGuard, ipGuard, signupLimiter, audit } = require('./security');
const LANGS = ['en', 'hi', 'kn'];

// Express 4 does not catch errors thrown inside async handlers, so every async route is wrapped with h().
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Shared by both login routes: blocks after too many wrong passwords. Returns true if the request was blocked.
function blockedByGuard(req, res, key, role, who) {
  const ip = clientIp(req);
  const c = loginGuard.check(key).blocked ? loginGuard.check(key) : ipGuard.check(ip);
  if (!c.blocked) return false;
  audit('LOGIN_BLOCKED', { req, role, detail: { who } });
  activity.log('Auth', `Login blocked for ${who}: too many wrong passwords. Try again in ${c.retryAfter}s`, 'auth');
  res.set('Retry-After', String(c.retryAfter));
  res.status(429).json({ error: `Too many wrong attempts. Please wait ${c.retryAfter} seconds and try again.` });
  return true;
}

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.full_name }, SECRET, { expiresIn: '12h' });
}

function auth(role) {
  return (req, res, next) => {
    const hd = req.headers.authorization || '';
    const token = hd.startsWith('Bearer ') ? hd.slice(7) : req.query.token;
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Please log in again.' });
    }
    if (req.user.role === 'doctor' && db.isDisabled(req.user.id)) return res.status(401).json({ error: 'This doctor account has been disabled. Contact the administrator.' });
    if (role && req.user.role !== role) return res.status(403).json({ error: `This action is for ${role}s only.` });
    next();
  };
}

function verifyToken(token) {
  try {
    const u = jwt.verify(token, SECRET);
    if (u.role === 'doctor' && db.isDisabled(u.id)) return null; // Day 11: a disabled doctor's login stops working everywhere at once (routes and sockets)
    return u;
  } catch { return null; }
}

const luhn = (num) => {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};

// Returns the appointment if this user is one of its two participants, otherwise null. (async now)
async function participant(apptId, userId) {
  const a = await db.getAppointment(apptId);
  if (!a) return null;
  return a.patient_id === userId || a.doctor_id === userId ? a : null;
}

const fileExists = (stored) => { const p = pdf.resolveStored(stored); return !!p && fs.existsSync(p); };

// Generates both PDFs if they do not exist yet (called after payment, and lazily on download).
// Day 8: if a PDF is missing from storage/ it is rebuilt, but a prescription is only rebuilt when its data still matches
// the signature. Rebuilding must never "re-sign" changed data.
async function ensureDocuments(apptId, baseUrl) {
  const a = await db.getAppointment(apptId);
  if (!a || a.payment_status !== 'paid') return;
  const doctor = await db.getDoctor(a.doctor_id);
  const patient = await db.getUserById(a.patient_id);
  const rx = await db.getRx(apptId);

  const rxLost = !!(rx && rx.file_path && !fileExists(rx.file_path));
  if (rx && (!rx.file_path || rxLost)) {
    const issuedAt = rxLost && rx.issued_at ? rx.issued_at : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const out = await pdf.generatePrescription({
      rxId: rx.id, doctorName: doctor.full_name, licenseId: doctor.license_id, department: doctor.department,
      patientName: patient.full_name, patientId: patient.id,
      items: JSON.parse(rx.items), notes: rx.notes, diagnosis: rx.diagnosis, issuedAt
    }, baseUrl);
    if (rxLost && !pdf.sameHash(out.hash, rx.sha256)) {
      try { fs.unlinkSync(out.filePath); } catch {}
      audit('DOCUMENT_REGEN_BLOCKED', { detail: { appointmentId: apptId, type: 'prescription', documentId: rx.id } });
      activity.log('Server', `Prescription ${rx.id} file is missing and its data no longer matches the signature. Not rebuilt`, 'error');
      const e = new Error('Prescription data no longer matches its signature.'); e.code = 'INTEGRITY'; throw e;
    }
    await db.setRxFile(rx.id, out.hash, out.fileName, issuedAt, out.fileSha256);
    if (rxLost) audit('DOCUMENT_REGENERATED', { detail: { appointmentId: apptId, type: 'prescription', documentId: rx.id } });
    activity.log('Server', `Prescription ${rx.id} ${rxLost ? 'rebuilt from verified data' : 'generated and signed'} (SHA-256 ${out.hash.slice(0, 12)}...)`, 'document');
  }

  const inv = await db.getInvoiceByAppointment(apptId);
  const invLost = !!(inv && inv.file_path && !fileExists(inv.file_path));
  if (inv && (!inv.file_path || invLost)) {
    const pay = await db.getPayment(inv.payment_id);
    const out = await pdf.generateInvoice({
      invoiceNo: inv.invoice_no, date: new Date(invLost && inv.created_at ? inv.created_at : Date.now()).toLocaleDateString('en-IN', { dateStyle: 'medium' }),
      patientName: patient.full_name, patientId: patient.id, doctorName: doctor.full_name, department: doctor.department,
      appointmentId: a.id, amount: pay.amount, method: pay.method, txnRef: pay.txn_ref
    });
    await db.setInvoiceFile(inv.id, out.fileName, out.fileSha256);
    if (invLost) audit('DOCUMENT_REGENERATED', { detail: { appointmentId: apptId, type: 'invoice', documentId: inv.invoice_no } });
    activity.log('Server', `Invoice ${inv.invoice_no} ${invLost ? 'rebuilt from the payment record' : 'generated as a separate PDF'}`, 'document');
  }
}

function buildRouter(io, sockets) {
  const r = express.Router();

  // ---------- Public ----------
  // Each doctor card also says whether the doctor is busy and how many patients are waiting (Day 6).
  r.get('/doctors', h(async (req, res) => {
    const docs = await db.listDoctors();
    const st = await queue.stateMap();
    res.json(docs.map((d) => { const s = st.get(d.id) || { inCall: false, waiting: 0 }; return { ...d, busy: s.inCall || s.waiting > 0, waiting: s.waiting }; }));
  }));

  r.get('/activity', (req, res) => res.json(activity.getRecent()));

  // WebRTC connection servers. STUN is always on; a TURN relay is added when set in .env (needed on some networks).
  r.get('/ice', (req, res) => {
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
    if (process.env.TURN_URL) {
      iceServers.push({ urls: process.env.TURN_URL.split(',').map((x) => x.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
    }
    res.json({ iceServers, relay: !!process.env.TURN_URL });
  });

  // Public: anyone who scans the QR code. Two layers must both hold: (1) the prescription data in the database still produces the signed
  // fingerprint, and (2) the stored PDF file is still the exact file that was issued. A failed check reveals no personal details.
  r.get('/verify/:hash', h(async (req, res) => {
    const hash = String(req.params.hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return res.json({ valid: false, reason: 'This is not a valid prescription signature.' });
    const rx = await db.getRxByHash(hash);
    if (!rx) return res.json({ valid: false, reason: 'No prescription matches this signature.' });
    const a = await db.getAppointment(rx.appointment_id);
    const doctor = await db.getDoctor(a.doctor_id);
    const patient = await db.getUserById(a.patient_id);
    const dataOk = pdf.checkRx(rx, doctor, patient);
    let fileOk = true;
    const abs = pdf.resolveStored(rx.file_path);
    if (rx.file_sha256 && abs && fs.existsSync(abs)) fileOk = pdf.sameHash(pdf.sha256Buf(fs.readFileSync(abs)), rx.file_sha256);
    const valid = dataOk && fileOk;
    audit(valid ? 'VERIFY_OK' : 'VERIFY_MISMATCH', { req, detail: { rxId: rx.id, dataOk, fileOk } });
    activity.log('Verifier', `Signature check for ${rx.id}: ${valid ? 'valid' : 'MISMATCH (' + (dataOk ? 'PDF file changed' : 'prescription data changed') + ')'}`, 'document');
    if (!valid) return res.json({ valid: false, reason: !dataOk ? 'The prescription on record has been changed since it was signed.' : 'The stored PDF is not the file that was issued.' });
    const parts = patient.full_name.split(' ');
    const masked = parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
    res.json({ valid: true, rxId: rx.id, doctor: doctor.full_name, patient: masked, issuedAt: rx.issued_at, signedBy: 'Pulscare Signing Authority (prototype)' });
  }));

  // ---------- Auth ----------
  r.post('/auth/register', h(async (req, res) => {
    const su = signupLimiter.take(clientIp(req));
    if (su.blocked) { res.set('Retry-After', String(su.retryAfter)); return res.status(429).json({ error: 'Too many sign-ups from this device. Please try again later.' }); }
    const { fullName, email, password, phone, language } = req.body || {};
    if (!fullName || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const em = String(email).toLowerCase().trim();
    if (await db.emailExists(em)) return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
    const id = uid('PT');
    let user;
    try {
      user = await db.createPatient({ id, fullName: fullName.trim(), email: em, passwordHash: bcrypt.hashSync(password, 10), phone, language: LANGS.includes(language) ? language : 'en' });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
      throw e;
    }
    audit('REGISTER', { req, actorId: id, role: 'patient' });
    activity.log('Auth', `New patient registered: ${user.full_name} (password stored as bcrypt hash)`, 'auth');
    res.json({ token: sign(user), user: { id, name: user.full_name, role: 'patient', language: user.preferred_language } });
  }));

  r.post('/auth/login', h(async (req, res) => {
    const { email, password } = req.body || {};
    const em = String(email || '').toLowerCase().trim();
    const key = clientIp(req) + '|patient|' + em;
    if (blockedByGuard(req, res, key, 'patient', em || '(empty)')) return;
    const user = await db.getPatientByEmail(em);
    if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      loginGuard.fail(key); ipGuard.fail(clientIp(req));
      audit('LOGIN_FAIL', { req, role: 'patient', detail: { who: em.slice(0, 80) } });
      activity.log('Auth', 'Patient login rejected (wrong email or password)', 'auth');
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    loginGuard.clear(key);
    audit('LOGIN_OK', { req, actorId: user.id, role: 'patient' });
    activity.log('Auth', `Patient ${user.full_name} logged in. JWT issued (12h)`, 'auth');
    res.json({ token: sign(user), user: { id: user.id, name: user.full_name, role: 'patient', language: user.preferred_language } });
  }));

  r.post('/auth/doctor-login', h(async (req, res) => {
    const { doctorId, password } = req.body || {};
    const did = String(doctorId || '').slice(0, 40);
    const key = clientIp(req) + '|doctor|' + did;
    if (blockedByGuard(req, res, key, 'doctor', did || '(empty)')) return;
    const user = await db.getDoctorUser(did);
    if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      loginGuard.fail(key); ipGuard.fail(clientIp(req));
      audit('LOGIN_FAIL', { req, role: 'doctor', detail: { who: did } });
      activity.log('Auth', 'Doctor login rejected (wrong password)', 'auth');
      return res.status(401).json({ error: 'Doctor ID or password is incorrect.' });
    }
    const drow = await db.getDoctor(user.id);
    if (drow && drow.disabled) {
      audit('LOGIN_DISABLED', { req, actorId: user.id, role: 'doctor' });
      activity.log('Auth', `${user.full_name} tried to log in but the account is disabled`, 'auth');
      return res.status(403).json({ error: 'This doctor account has been disabled. Contact the administrator.' });
    }
    loginGuard.clear(key);
    audit('LOGIN_OK', { req, actorId: user.id, role: 'doctor' });
    activity.log('Auth', `${user.full_name} logged in. JWT issued with role=doctor`, 'auth');
    res.json({ token: sign(user), user: { id: user.id, name: user.full_name, role: 'doctor' } });
  }));

  r.get('/me', auth(), (req, res) => res.json(req.user));

  // ---------- Doctor presence ----------
  r.post('/doctor/online', auth('doctor'), h(async (req, res) => {
    const online = req.body.online ? 1 : 0;
    await db.setDoctorOnline(req.user.id, online);
    io.emit('presence:update', { doctorId: req.user.id, online: !!online });
    if (!online) await queue.clearQueue(req.user.id, 'The doctor went offline');
    activity.log('Presence', `${req.user.name} is now ${online ? 'ONLINE' : 'offline'}. All patients notified live`, 'presence');
    res.json({ online: !!online });
  }));

  // ---------- Consultation requests ----------
  r.post('/requests', auth('patient'), h(async (req, res) => {
    const { doctorId, symptoms } = req.body || {};
    const doc = await db.getDoctor(String(doctorId || ''));
    if (!doc || doc.disabled) return res.status(404).json({ error: 'Doctor not found.' });
    if (!doc.is_online) return res.status(409).json({ error: `${doc.full_name} is offline right now. Choose an online doctor.` });
    if (await db.hasPendingRequest(req.user.id, doctorId)) {
      return res.status(409).json({ error: 'You already have a pending request with this doctor.' });
    }
    // Doctor busy (in a call, or others already waiting): the patient joins the waiting queue instead of being rejected.
    if (await queue.shouldQueue(doctorId)) {
      const q = await queue.enqueue(req.user, doc, symptoms);
      if (q.error) return res.status(409).json({ error: q.error });
      return res.json({ queued: true, ...q });
    }
    const id = uid('REQ');
    await db.createRequest({ id, patientId: req.user.id, doctorId, symptoms: (symptoms || '').slice(0, 300) });
    const payload = { id, patientId: req.user.id, patientName: req.user.name, symptoms: symptoms || '', patientLanguages: await db.getLanguages(req.user.id), createdAt: new Date().toISOString() };
    io.to('user:' + doctorId).emit('request:new', payload);
    notify.push(doctorId, { kind: 'new_request', title: 'New consultation request', body: `${req.user.name}${symptoms ? ': ' + String(symptoms).slice(0, 80) : ''}`, link: '/doctor.html', dedupeKey: 'req:' + id });
    activity.log('Requests', `${req.user.name} requested ${doc.full_name}. Pushed to the doctor instantly (no refresh)`, 'request');
    setTimeout(async () => {
      try {
        if (await db.transitionRequest(id, 'pending', 'expired')) {
          io.to('user:' + req.user.id).emit('request:update', { requestId: id, status: 'expired' });
          io.to('user:' + doctorId).emit('request:update', { requestId: id, status: 'expired' });
          activity.log('Requests', `Request ${id} expired after 2 minutes`, 'request');
        }
      } catch (e) { console.error('Request expiry error:', e.message); }
    }, 120000);
    res.json({ requestId: id, doctorName: doc.full_name });
  }));

  r.get('/requests/pending', auth('doctor'), h(async (req, res) => {
    const rows = await db.pendingForDoctor(req.user.id);
    const out = [];
    for (const x of rows) out.push({ ...x, patientLanguages: await db.getLanguages(x.patientId) });
    res.json(out);
  }));

  r.post('/requests/:id/respond', auth('doctor'), h(async (req, res) => {
    const reqRow = await db.getRequestForDoctor(req.params.id, req.user.id);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: `This request is already ${reqRow.status}.` });
    if (!req.body.accept) {
      if (!(await db.transitionRequest(reqRow.id, 'pending', 'rejected'))) return res.status(409).json({ error: 'This request was already handled.' });
      io.to('user:' + reqRow.patient_id).emit('request:update', { requestId: reqRow.id, status: 'rejected' });
      activity.log('Requests', `${req.user.name} declined request ${reqRow.id}`, 'request');
      return res.json({ status: 'rejected' });
    }
    const doc = await db.getDoctor(req.user.id);
    const apptId = uid('APT');
    const room = crypto.randomBytes(12).toString('hex');
    const ok = await db.acceptRequest(reqRow, { apptId, room, fee: doc.fee });
    if (!ok) return res.status(409).json({ error: 'This request was already handled.' });
    io.to('user:' + reqRow.patient_id).emit('request:update', { requestId: reqRow.id, status: 'accepted', appointmentId: apptId });
    queue.broadcast(req.user.id).catch(() => {});   // the doctor is busy now: patient cards update live
    activity.log('Appointments', `Appointment ${apptId} created. Private room id ${room.slice(0, 8)}... generated. Fee Rs ${doc.fee} read from the database`, 'appointment');
    res.json({ status: 'accepted', appointmentId: apptId });
  }));

  // ---------- Appointments ----------
  r.get('/appointments', auth(), h(async (req, res) => {
    res.json(await db.listAppointmentsFor(req.user.role, req.user.id));
  }));

  r.get('/appointments/:id', auth(), h(async (req, res) => {
    if (!(await participant(req.params.id, req.user.id))) return res.status(404).json({ error: 'Appointment not found.' });
    const a = await db.getAppointmentFull(req.params.id);
    const rx = await db.getRx(req.params.id);
    res.json({ ...a, draft: req.user.role === 'doctor' && rx ? { items: JSON.parse(rx.items), notes: rx.notes, diagnosis: rx.diagnosis } : null });
  }));

  r.put('/appointments/:id/prescription', auth('doctor'), h(async (req, res) => {
    const a = await participant(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Appointment not found.' });
    if (a.payment_status === 'paid') return res.status(409).json({ error: 'This prescription is already issued.' });
    const items = (req.body.items || [])
      .map(i => ({ medicine: String(i.medicine || '').trim().slice(0, 80), dose: String(i.dose || '').trim().slice(0, 30),
        frequency: String(i.frequency || '').trim().slice(0, 40), timing: String(i.timing || '').trim().slice(0, 30), days: Number(i.days) || 0 }))
      .filter(i => i.medicine);
    if (!items.length) return res.status(400).json({ error: 'Add at least one medicine.' });
    const notes = String(req.body.notes || '').slice(0, 600);
    const diagnosis = String(req.body.diagnosis || '').slice(0, 200);
    await db.saveRxDraft(a.id, { items: JSON.stringify(items), notes, diagnosis });
    activity.log('Prescription', `${req.user.name} saved a draft with ${items.length} medicine(s). Locked until payment is complete`, 'document');
    res.json({ saved: true });
  }));

  r.get('/messages/:appointmentId', auth(), h(async (req, res) => {
    if (!(await participant(req.params.appointmentId, req.user.id))) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(await db.listMessages(req.params.appointmentId));
  }));

  // ---------- Payment (simulated gateway, real server-side logic) ----------
  r.post('/payments/pay', auth('patient'), h(async (req, res) => {
    const { appointmentId, method, card, upi } = req.body || {};
    const a = await participant(appointmentId, req.user.id);
    if (!a) return res.status(404).json({ error: 'Appointment not found.' });
    if (a.payment_status === 'paid') return res.status(409).json({ error: 'This appointment is already paid.' });
    if (a.status !== 'awaiting_payment') return res.status(409).json({ error: 'Payment opens after the doctor ends the call.' });

    let failure = null, ref = 'TXN' + crypto.randomBytes(5).toString('hex').toUpperCase(), label;
    if (method === 'card') {
      const num = String((card && card.number) || '').replace(/\s+/g, '');
      const m = String((card && card.expiry) || '').match(/^(\d{2})\/(\d{2})$/);
      if (!/^\d{13,19}$/.test(num) || !luhn(num)) return res.status(400).json({ error: 'Card number is not valid. Use the test card shown on screen.' });
      if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return res.status(400).json({ error: 'Enter expiry as MM/YY.' });
      if (!/^\d{3,4}$/.test(String((card && card.cvv) || ''))) return res.status(400).json({ error: 'Enter the 3-digit CVV.' });
      label = 'Card **** ' + num.slice(-4);
      if (num === '4000000000000002') failure = 'Card declined by the issuing bank (test card).';
    } else if (method === 'upi') {
      const id = String(upi || '').trim();
      if (!/^[\w.\-]{2,}@[a-z]{2,}$/i.test(id)) return res.status(400).json({ error: 'Enter a valid UPI ID like name@bank.' });
      label = 'UPI ' + id;
      if (id.toLowerCase().startsWith('fail@')) failure = 'UPI request was declined (test ID).';
    } else return res.status(400).json({ error: 'Choose a payment method.' });

    const payId = uid('PAY');
    if (failure) {
      await db.insertFailedPayment({ id: payId, appointmentId: a.id, label, amount: a.fee, ref, reason: failure });
      audit('PAYMENT_FAIL', { req, actorId: req.user.id, role: 'patient', detail: { appointmentId: a.id, paymentId: payId, amount: a.fee, reason: failure } });
      activity.log('Payments', `Payment FAILED for ${a.id}: ${failure} No invoice or prescription released`, 'payment');
      return res.status(402).json({ error: failure });
    }

    // One database transaction: payment saved, invoice number allocated, invoice saved, appointment marked paid.
    let invoiceNo;
    try {
      invoiceNo = await db.completePayment({ payId, invId: uid('INV'), apptId: a.id, label, amount: a.fee, ref });
    } catch (e) {
      if (e.code === 'ALREADY_PAID') return res.status(409).json({ error: 'This appointment is already paid.' });
      throw e;
    }
    audit('PAYMENT_OK', { req, actorId: req.user.id, role: 'patient', detail: { appointmentId: a.id, paymentId: payId, invoiceNo, amount: a.fee, method: label } });
    activity.log('Payments', `Payment verified on the server: Rs ${a.fee} (${label}). Appointment ${a.id} marked paid`, 'payment');
    activity.log('Server', `Invoice number ${invoiceNo} allocated`, 'document');

    try { await ensureDocuments(a.id, `${req.protocol}://${req.get('host')}`); }
    catch (e) { console.error('PDF generation error', e); activity.log('Server', 'Document generation failed, will retry on download', 'error'); }

    io.to('user:' + a.doctor_id).emit('appointment:paid', { appointmentId: a.id });
    const payDoc = await db.getDoctor(a.doctor_id);
    notify.push(req.user.id, { kind: 'payment_done', title: 'Payment received', body: `Rs ${a.fee} paid to ${payDoc ? payDoc.full_name : 'your doctor'}. Your prescription and invoice are ready.`, link: '/patient.html', dedupeKey: 'pay:' + a.id });
    notify.push(a.doctor_id, { kind: 'payment_done', title: 'Patient has paid', body: `${req.user.name} paid Rs ${a.fee}. The prescription was released.`, link: '/doctor.html', dedupeKey: 'pay:' + a.id });
    res.json({ paid: true, appointmentId: a.id, invoiceNo, txnRef: ref });
  }));

  // ---------- Documents ----------
  // Only the two people on the appointment can open its documents. Every refusal is written to the audit log.
  // Before a PDF is sent: (1) a prescription's data must still match its signature, (2) the file must match the fingerprint taken when it was issued.
  r.get('/documents/:appointmentId/:type', auth(), h(async (req, res) => {
    const type = req.params.type;
    const deny = (status, msg, why) => {
      audit('DOCUMENT_DENIED', { req, actorId: req.user.id, role: req.user.role, detail: { appointmentId: req.params.appointmentId, type, why } });
      return res.status(status).json({ error: msg });
    };
    const a = await participant(req.params.appointmentId, req.user.id);
    if (!a) return deny(404, 'Appointment not found.', 'not-a-participant');
    if (type !== 'prescription' && type !== 'invoice') return res.status(400).json({ error: 'Unknown document type.' });
    if (a.payment_status !== 'paid') return res.status(402).json({ error: 'Documents are released after payment.' });
    if (req.user.role === 'doctor' && type === 'invoice') return deny(403, 'Invoices are for patients.', 'doctor-invoice');

    const blocked = (layer, documentId) => {
      audit('DOCUMENT_INTEGRITY_FAIL', { req, actorId: req.user.id, role: req.user.role, detail: { appointmentId: a.id, type, documentId, layer } });
      activity.log('Documents', `${type} ${documentId} was NOT released: integrity check failed (${layer})`, 'error');
      return res.status(409).json({ error: 'This document failed its integrity check and cannot be released. Please contact support.' });
    };
    try { await ensureDocuments(a.id, `${req.protocol}://${req.get('host')}`); }
    catch (e) {
      if (e.code === 'INTEGRITY') return blocked('data', type);
      return res.status(500).json({ error: 'Could not generate the document.' });
    }

    let row, docId, table;
    if (type === 'prescription') { row = await db.getRx(a.id); docId = row && row.id; table = 'prescriptions'; }
    else { row = await db.getInvoiceByAppointment(a.id); docId = row && row.invoice_no; table = 'invoices'; }
    const abs = row && row.file_path ? pdf.resolveStored(row.file_path) : null;
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Document not found.' });

    if (type === 'prescription') {
      const doctor = await db.getDoctor(a.doctor_id);
      const patient = await db.getUserById(a.patient_id);
      if (!pdf.checkRx(row, doctor, patient)) return blocked('data', docId);
    }
    const bytes = fs.readFileSync(abs);
    const actual = pdf.sha256Buf(bytes);
    if (!row.file_sha256) {
      await db.setDocFileSha(table, row.id, actual); // issued before fingerprints existed: fingerprint it now, check it from here on
      audit('DOCUMENT_FINGERPRINT_ADOPTED', { req, actorId: req.user.id, role: req.user.role, detail: { appointmentId: a.id, type, documentId: docId } });
    } else if (!pdf.sameHash(actual, row.file_sha256)) return blocked('file', docId);

    audit('DOCUMENT_DOWNLOAD', { req, actorId: req.user.id, role: req.user.role, detail: { appointmentId: a.id, type, documentId: docId } });
    activity.log('Documents', `${req.user.name} downloaded ${type} ${docId}`, 'document');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(docId).replace(/[^\w.-]/g, '_')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(bytes);
  }));

  return r;
}

module.exports = { buildRouter, verifyToken, participant };
