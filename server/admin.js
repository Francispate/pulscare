// PASTE AS: server/admin.js  (new file)
// Day 11: the admin panel's server side.
//   An admin can: see counts, list / add / disable / enable doctors, see appointments and payments, read the audit log.
//   An admin can NOT read chat messages, medical records, or open anyone's PDFs. Those stay private to patient and doctor.
// Admin accounts are created only from the command line (scripts/create-admin.js), never through the website.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const { uid } = db;
const { supabase } = require('./supabase');
const activity = require('./activity');
const notify = require('./notify');
const queue = require('./queue');
const { JWT_SECRET, clientIp, loginGuard, ipGuard, audit } = require('./security');
const { verifyToken } = require('./routes');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function must(res) { if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; } return res.data; }
const rows = (res) => must(res) || [];
const istText = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const lim = (v, def = 100, max = 200) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

// A password that is easy to read out loud: no 0/O, 1/l/I.
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const makePassword = (n = 10) => Array.from(crypto.randomBytes(n), (b) => PW_CHARS[b % PW_CHARS.length]).join('');

function buildAdminRouter(io) {
  const r = express.Router();

  const adminOnly = (req, res, next) => {
    const hd = req.headers.authorization || '';
    const user = verifyToken(hd.startsWith('Bearer ') ? hd.slice(7) : '');
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    if (user.role !== 'admin') {
      audit('ADMIN_DENIED', { req, actorId: user.id, role: user.role, detail: { path: req.path } });
      return res.status(403).json({ error: 'This area is for administrators only.' });
    }
    req.user = user; next();
  };

  // ---------- Login (same wrong-password protection as patients and doctors) ----------
  r.post('/auth/admin-login', h(async (req, res) => {
    const { email, password } = req.body || {};
    const em = String(email || '').toLowerCase().trim().slice(0, 120);
    const key = clientIp(req) + '|admin|' + em;
    const c = loginGuard.check(key).blocked ? loginGuard.check(key) : ipGuard.check(clientIp(req));
    if (c.blocked) {
      audit('LOGIN_BLOCKED', { req, role: 'admin', detail: { who: em } });
      res.set('Retry-After', String(c.retryAfter));
      return res.status(429).json({ error: `Too many wrong attempts. Please wait ${c.retryAfter} seconds and try again.` });
    }
    const u = must(await supabase.from('users').select('id, full_name, password_hash').eq('email', em).eq('role', 'admin').maybeSingle());
    if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
      loginGuard.fail(key); ipGuard.fail(clientIp(req));
      audit('LOGIN_FAIL', { req, role: 'admin', detail: { who: em } });
      activity.log('Auth', 'Admin login rejected (wrong email or password)', 'auth');
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    loginGuard.clear(key);
    audit('LOGIN_OK', { req, actorId: u.id, role: 'admin' });
    activity.log('Auth', `Admin ${u.full_name} logged in (4h session)`, 'auth');
    res.json({ token: jwt.sign({ id: u.id, role: 'admin', name: u.full_name }, JWT_SECRET, { expiresIn: '4h' }), user: { id: u.id, name: u.full_name, role: 'admin' } });
  }));

  // ---------- Counts ----------
  r.get('/admin/stats', adminOnly, h(async (req, res) => {
    const count = async (q) => { const x = await q; if (x.error) throw new Error(x.error.message); return x.count || 0; };
    const head = (t) => supabase.from(t).select('id', { count: 'exact', head: true });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [patients, doctors, disabled, online, appts, paidAppts, queueNow, payOk, payFail, evts] = await Promise.all([
      count(head('users').eq('role', 'patient')), count(head('doctors')), count(head('doctors').eq('disabled', true)), count(head('doctors').eq('is_online', 1)),
      supabase.from('appointments').select('status'), count(head('appointments').eq('payment_status', 'paid')),
      count(head('queue_entries').in('status', ['waiting', 'notified'])),
      supabase.from('payments').select('amount').eq('status', 'paid'), count(head('payments').eq('status', 'failed')),
      supabase.from('audit_log').select('action').gte('at', since).limit(5000)
    ]);
    const byStatus = {}; rows(appts).forEach((a) => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
    const tally = {}; rows(evts).forEach((e) => { tally[e.action] = (tally[e.action] || 0) + 1; });
    res.json({
      patients, doctors: { total: doctors, active: doctors - disabled, disabled, online },
      appointments: { total: rows(appts).length, byStatus, paid: paidAppts },
      payments: { paidCount: rows(payOk).length, failedCount: payFail, revenue: rows(payOk).reduce((s, p) => s + Number(p.amount || 0), 0) },
      queueWaiting: queueNow,
      last24h: {
        loginsOk: tally.LOGIN_OK || 0, loginsFailed: tally.LOGIN_FAIL || 0, loginsBlocked: tally.LOGIN_BLOCKED || 0,
        integrityFailures: tally.DOCUMENT_INTEGRITY_FAIL || 0, refusedDownloads: tally.DOCUMENT_DENIED || 0, recordViews: tally.RECORD_VIEW || 0, recordRefusals: tally.RECORD_DENIED || 0
      }
    });
  }));

  // ---------- Doctors ----------
  r.get('/admin/doctors', adminOnly, h(async (req, res) => {
    const docs = rows(await supabase.from('doctors').select('id, license_id, department, qualification, fee, is_online, disabled, disabled_at, disabled_reason').order('id'));
    const ids = docs.map((d) => d.id);
    const users = ids.length ? rows(await supabase.from('users').select('id, full_name, email').in('id', ids)) : [];
    const appts = ids.length ? rows(await supabase.from('appointments').select('doctor_id, status').in('doctor_id', ids)) : [];
    const u = Object.fromEntries(users.map((x) => [x.id, x]));
    res.json(docs.map((d) => {
      const mine = appts.filter((a) => a.doctor_id === d.id);
      return {
        id: d.id, name: u[d.id] ? u[d.id].full_name : '', email: u[d.id] ? u[d.id].email : '', licenseId: d.license_id, department: d.department, qualification: d.qualification || '',
        fee: d.fee, online: !!d.is_online, disabled: !!d.disabled, disabledAt: d.disabled_at, disabledReason: d.disabled_reason || '',
        appointments: mine.length, inCall: mine.filter((a) => a.status === 'in_progress').length
      };
    }));
  }));

  r.post('/admin/doctors', adminOnly, h(async (req, res) => {
    const b = req.body || {};
    const fullName = String(b.fullName || '').trim().replace(/\s+/g, ' ');
    const email = String(b.email || '').toLowerCase().trim();
    const department = String(b.department || '').trim();
    const qualification = String(b.qualification || '').trim().slice(0, 120);
    const about = String(b.about || '').trim().slice(0, 300);
    const licenseId = String(b.licenseId || '').trim();
    const fee = Number(b.fee);
    if (fullName.length < 3 || fullName.length > 80) return res.status(400).json({ error: 'Enter the doctor’s full name (3 to 80 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (department.length < 2 || department.length > 40) return res.status(400).json({ error: 'Enter a department (2 to 40 characters).' });
    if (!/^[A-Za-z0-9\-\/]{3,30}$/.test(licenseId)) return res.status(400).json({ error: 'The licence ID must be 3 to 30 letters, numbers, - or /.' });
    if (!(fee > 0 && fee <= 100000)) return res.status(400).json({ error: 'Enter a fee between 1 and 100000.' });
    if (await db.emailExists(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const lic = await supabase.from('doctors').select('id').eq('license_id', licenseId).maybeSingle();
    if (lic.data) return res.status(409).json({ error: 'That licence ID is already registered to another doctor.' });

    const password = makePassword();
    const hash = bcrypt.hashSync(password, 10);
    let id = null;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {                // the next free DOC-number; retried if two admins add at the same moment
      const all = rows(await supabase.from('doctors').select('id'));
      const next = Math.max(1000, ...all.map((d) => parseInt(String(d.id).replace(/\D/g, ''), 10) || 0)) + 1;
      const tryId = 'DOC-' + next;
      const ins = await supabase.from('users').insert({ id: tryId, role: 'doctor', full_name: fullName, email, password_hash: hash, languages: 'English' });
      if (!ins.error) id = tryId;
      else if (ins.error.code === '23505' && /email/i.test(ins.error.message)) return res.status(409).json({ error: 'An account with this email already exists.' });
      else if (ins.error.code !== '23505') throw new Error(ins.error.message);
    }
    if (!id) throw new Error('Could not allocate a doctor ID. Please try again.');
    const d = await supabase.from('doctors').insert({ id, license_id: licenseId, department, qualification, about, fee });
    if (d.error) {
      await supabase.from('users').delete().eq('id', id);                // never leave a half-created doctor behind
      if (d.error.code === '23505') return res.status(409).json({ error: 'That licence ID is already registered to another doctor.' });
      throw new Error(d.error.message);
    }
    audit('DOCTOR_ADD', { req, actorId: req.user.id, role: 'admin', detail: { doctorId: id, licenseId, department } });
    activity.log('Admin', `${req.user.name} added ${fullName} (${id}, ${department}). A one-time password was generated`, 'auth');
    io.emit('presence:update', { doctorId: id, online: false });          // patients' lists refresh
    res.json({ doctor: { id, name: fullName, email, department, fee, licenseId }, password }); // the password is shown once and never stored in readable form
  }));

  r.post('/admin/doctors/:id/disable', adminOnly, h(async (req, res) => {
    const id = String(req.params.id).slice(0, 40);
    const doc = await db.getDoctor(id);
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
    if (doc.disabled) return res.status(409).json({ error: 'This doctor is already disabled.' });
    const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
    must(await supabase.from('doctors').update({ disabled: true, disabled_at: new Date().toISOString(), disabled_reason: reason || null, is_online: 0 }).eq('id', id));
    db.setDisabledCache(id, true);                                          // from this moment every login of theirs is refused

    // 1. Take them offline for patients, 2. empty their waiting queue, 3. close their open pages.
    io.emit('presence:update', { doctorId: id, online: false });
    await queue.clearQueue(id, 'This doctor is no longer available').catch(() => {});
    io.in('user:' + id).disconnectSockets(true);

    // 4. Cancel their upcoming booked visits that have not started, and tell each patient.
    const upcoming = rows(await supabase.from('doctor_slots').select('id').eq('doctor_id', id).not('patient_id', 'is', null).gt('starts_at', new Date().toISOString()));
    let cancelled = 0;
    for (const s of upcoming) {
      const c = await supabase.rpc('cancel_slot', { p_slot_id: s.id, p_actor_id: id });
      if (c.error || !c.data) continue;                                     // a visit that already started is left alone
      cancelled++;
      io.to('user:' + c.data.patient_id).emit('slot:cancelled', { startsAt: c.data.starts_at, by: 'admin' });
      notify.push(c.data.patient_id, { kind: 'slot_cancelled', title: 'Booking cancelled', body: `${doc.full_name} is no longer available, so your ${istText(c.data.starts_at)} IST visit was cancelled. Please book another doctor.`, link: '/patient.html', dedupeKey: c.data.appointment_id ? 'cancel:' + c.data.appointment_id : null });
    }
    io.emit('slot:update', { doctorId: id });

    audit('DOCTOR_DISABLE', { req, actorId: req.user.id, role: 'admin', detail: { doctorId: id, reason, cancelledBookings: cancelled } });
    activity.log('Admin', `${req.user.name} DISABLED ${doc.full_name}${reason ? ' (' + reason + ')' : ''}. Offline now, queue cleared, ${cancelled} upcoming booking(s) cancelled`, 'error');
    res.json({ disabled: true, cancelledBookings: cancelled, wasOnline: !!doc.is_online });
  }));

  r.post('/admin/doctors/:id/enable', adminOnly, h(async (req, res) => {
    const id = String(req.params.id).slice(0, 40);
    const doc = await db.getDoctor(id);
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
    if (!doc.disabled) return res.status(409).json({ error: 'This doctor is not disabled.' });
    must(await supabase.from('doctors').update({ disabled: false, disabled_at: null, disabled_reason: null }).eq('id', id));
    db.setDisabledCache(id, false);
    io.emit('presence:update', { doctorId: id, online: false });
    audit('DOCTOR_ENABLE', { req, actorId: req.user.id, role: 'admin', detail: { doctorId: id } });
    activity.log('Admin', `${req.user.name} enabled ${doc.full_name} again. They must log in and go online themselves`, 'auth');
    res.json({ disabled: false });
  }));

  // ---------- Appointments and payments (who, when, how much; never the content) ----------
  r.get('/admin/appointments', adminOnly, h(async (req, res) => {
    let q = supabase.from('appointments').select('id, patient_id, doctor_id, status, payment_status, fee, created_at, slot_id').order('created_at', { ascending: false }).limit(lim(req.query.limit));
    const st = String(req.query.status || '');
    if (['booked', 'in_progress', 'awaiting_payment', 'completed'].includes(st)) q = q.eq('status', st);
    const list = rows(await q);
    const ids = [...new Set(list.flatMap((a) => [a.patient_id, a.doctor_id]))];
    const users = ids.length ? rows(await supabase.from('users').select('id, full_name').in('id', ids)) : [];
    const n = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
    res.json(list.map((a) => ({ id: a.id, createdAt: a.created_at, patient: n[a.patient_id] || a.patient_id, doctor: n[a.doctor_id] || a.doctor_id, status: a.status, paymentStatus: a.payment_status, fee: a.fee, fromSlot: !!a.slot_id })));
  }));

  r.get('/admin/payments', adminOnly, h(async (req, res) => {
    const list = rows(await supabase.from('payments').select('id, appointment_id, method, amount, status, txn_ref, failure_reason, created_at').order('created_at', { ascending: false }).limit(lim(req.query.limit)));
    const ap = list.length ? rows(await supabase.from('appointments').select('id, patient_id, doctor_id').in('id', [...new Set(list.map((p) => p.appointment_id))])) : [];
    const ids = [...new Set(ap.flatMap((a) => [a.patient_id, a.doctor_id]))];
    const users = ids.length ? rows(await supabase.from('users').select('id, full_name').in('id', ids)) : [];
    const n = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
    const a = Object.fromEntries(ap.map((x) => [x.id, x]));
    res.json(list.map((p) => ({
      id: p.id, createdAt: p.created_at, appointmentId: p.appointment_id, patient: a[p.appointment_id] ? n[a[p.appointment_id].patient_id] : '', doctor: a[p.appointment_id] ? n[a[p.appointment_id].doctor_id] : '',
      method: p.method, amount: p.amount, status: p.status, txnRef: p.txn_ref || '', failureReason: p.failure_reason || ''
    })));
  }));

  // ---------- Audit log ----------
  r.get('/admin/audit', adminOnly, h(async (req, res) => {
    let q = supabase.from('audit_log').select('id, at, action, actor_id, actor_role, ip, detail').order('id', { ascending: false }).limit(lim(req.query.limit));
    const group = String(req.query.group || '');
    if (/^[A-Z_]{2,24}$/.test(group)) q = q.like('action', group + '%');
    const actor = String(req.query.actor || '').trim().slice(0, 40);
    if (actor) q = q.eq('actor_id', actor);
    const before = parseInt(req.query.before, 10);
    if (before > 0) q = q.lt('id', before);
    res.json(rows(await q).map((e) => ({ id: e.id, at: e.at, action: e.action, actorId: e.actor_id, role: e.actor_role, ip: e.ip, detail: e.detail || {} })));
  }));

  return r;
}

module.exports = { buildAdminRouter };
