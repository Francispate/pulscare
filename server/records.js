// PASTE AS: server/records.js  (new file)
// Day 10: the patient medical record.
//   Patient: adds allergies and conditions, uploads reports, sees one timeline (consults, prescriptions, reports, entries).
//   Doctor: read-only, and ONLY for a patient they have an accepted appointment with (during it, or after it).
//           A visit booked from a slot counts once its room opens (10 minutes before the start time).
// Every doctor view is written to audit_log and the patient gets a notification. Prescription drafts stay hidden until payment.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { uid } = db;
const { supabase } = require('./supabase');
const activity = require('./activity');
const notify = require('./notify');
const { audit } = require('./security');
const { verifyToken } = require('./routes');
const { TYPES, looksRight } = require('./attachments');

const DIR = path.join(__dirname, '..', 'storage', 'records');
fs.mkdirSync(DIR, { recursive: true });

const MAX_ENTRIES = 40;
const MAX_REPORTS = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const SEVERITIES = ['mild', 'moderate', 'severe'];

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function must(res) { if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; } return res.data; }
const rows = (res) => must(res) || [];
const none = { data: [], error: null };
const uniq = (a) => [...new Set(a)];
const filePathOf = (row) => path.join(DIR, path.basename(String(row.file_path || '').replace(/\\/g, '/')));

// ---------- Who may see a patient's record? ----------
async function doctorMayView(doctorId, patientId) {
  const appts = rows(await supabase.from('appointments').select('id, status, slot_id').eq('doctor_id', doctorId).eq('patient_id', patientId));
  if (!appts.length) return false;
  const slotIds = appts.filter((a) => a.slot_id && a.status === 'booked').map((a) => a.slot_id);
  const slots = slotIds.length ? rows(await supabase.from('doctor_slots').select('id, patient_id, starts_at').in('id', slotIds)) : [];
  const slot = Object.fromEntries(slots.map((s) => [s.id, s]));
  return appts.some((a) => {
    if (a.status !== 'booked' || !a.slot_id) return true;                       // accepted request, call running, or finished
    const s = slot[a.slot_id];                                                  // booked slot: only once the room has opened
    return !!s && s.patient_id === patientId && new Date(s.starts_at).getTime() <= Date.now() + 10 * 60000;
  });
}

const parseItems = (s) => { try { const x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch { return []; } };

// ---------- Building the record ----------
// viewer = { role: 'patient' | 'doctor', id }
async function buildRecord(patientId, viewer) {
  const patient = await db.getUserById(patientId);
  const [histRes, repRes, apptRes] = await Promise.all([
    supabase.from('medical_history').select('id, kind, name, note, severity, created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('record_reports').select('id, title, filename, mime, size, report_date, created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('appointments').select('id, doctor_id, created_at').eq('patient_id', patientId).eq('payment_status', 'paid').order('created_at', { ascending: false }).limit(100)
  ]);
  const hist = rows(histRes), reps = rows(repRes), appts = rows(apptRes);   // only PAID consultations: drafts are never shown
  const apptIds = appts.map((a) => a.id), docIds = uniq(appts.map((a) => a.doctor_id));
  const [uRes, dRes, rxRes, atRes] = await Promise.all([
    docIds.length ? supabase.from('users').select('id, full_name').in('id', docIds) : none,
    docIds.length ? supabase.from('doctors').select('id, department').in('id', docIds) : none,
    apptIds.length ? supabase.from('prescriptions').select('id, appointment_id, items, notes, diagnosis').in('appointment_id', apptIds) : none,
    apptIds.length ? supabase.from('attachments').select('id, appointment_id, filename, mime, size, created_at').in('appointment_id', apptIds) : none
  ]);
  const name = Object.fromEntries(rows(uRes).map((u) => [u.id, u.full_name]));
  const dept = Object.fromEntries(rows(dRes).map((d) => [d.id, d.department]));
  const rxBy = Object.fromEntries(rows(rxRes).map((r) => [r.appointment_id, r]));
  const canOpen = (a) => viewer.role === 'patient' || a.doctor_id === viewer.id;   // PDFs and consult files open only for the people in that consult

  const timeline = [];
  for (const a of appts) {
    const rx = rxBy[a.id];
    const open = canOpen(a);
    timeline.push({ type: 'consult', at: a.created_at, title: `Consultation with ${name[a.doctor_id] || 'a doctor'}`, sub: dept[a.doctor_id] || '', detail: rx && rx.diagnosis ? rx.diagnosis : '', appointmentId: a.id });
    if (rx) timeline.push({
      type: 'prescription', at: a.created_at, title: `Prescription ${rx.id}`, sub: name[a.doctor_id] || '', detail: rx.notes || '', appointmentId: a.id,
      medicines: parseItems(rx.items).map((i) => ({ medicine: i.medicine, dose: i.dose, frequency: i.frequency, timing: i.timing, days: i.days })),
      open: open ? { url: `/api/documents/${a.id}/prescription`, name: `${rx.id}.pdf` } : null
    });
    for (const f of rows(atRes).filter((x) => x.appointment_id === a.id)) {
      timeline.push({ type: 'report', source: 'consult', at: f.created_at, title: f.filename, sub: 'Shared during a consultation', size: f.size, mime: f.mime, open: open ? { url: `/api/attachments/${f.id}/file`, name: f.filename } : null });
    }
  }
  for (const r of reps) timeline.push({ type: 'report', source: 'record', at: r.report_date ? `${r.report_date}T00:00:00.000Z` : r.created_at, title: r.title, sub: r.filename, size: r.size, mime: r.mime, open: { url: `/api/records/reports/${r.id}/file`, name: r.filename } });
  for (const x of hist) timeline.push({ type: x.kind, at: x.created_at, title: x.name, sub: x.kind === 'allergy' && x.severity ? `${x.severity} allergy` : '', detail: x.note || '' });
  timeline.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const pick = (kind) => hist.filter((x) => x.kind === kind).map((x) => ({ id: x.id, name: x.name, note: x.note, severity: x.severity, createdAt: x.created_at }));
  return {
    viewer: viewer.role,
    patient: { id: patient.id, name: patient.full_name },
    profile: { allergies: pick('allergy'), conditions: pick('condition') },
    reports: reps.map((r) => ({ id: r.id, title: r.title, filename: r.filename, mime: r.mime, size: r.size, reportDate: r.report_date, createdAt: r.created_at, url: `/api/records/reports/${r.id}/file` })),
    timeline
  };
}

// ---------- Routes ----------
function buildRecordsRouter() {
  const r = express.Router();
  // A header token is normal. A ?token= is allowed too, only so a file link can open in a new tab.
  const auth = (role) => (req, res, next) => {
    const hd = req.headers.authorization || '';
    const user = verifyToken(hd.startsWith('Bearer ') ? hd.slice(7) : req.query.token);
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    if (role && user.role !== role) return res.status(403).json({ error: `This action is for ${role}s only.` });
    req.user = user; next();
  };

  r.get('/records/me', auth('patient'), h(async (req, res) => {
    res.json(await buildRecord(req.user.id, { role: 'patient', id: req.user.id }));
  }));

  r.get('/records/patient/:patientId', auth('doctor'), h(async (req, res) => {
    const patientId = String(req.params.patientId).slice(0, 40);
    const patient = await db.getUserById(patientId);
    if (!patient || patient.role !== 'patient' || !(await doctorMayView(req.user.id, patientId))) {
      audit('RECORD_DENIED', { req, actorId: req.user.id, role: 'doctor', detail: { patientId } });
      activity.log('Records', `${req.user.name} tried to open a patient record without an accepted appointment. Refused`, 'error');
      return res.status(403).json({ error: 'You can see a patient’s record only during or after a consultation with them.' });
    }
    audit('RECORD_VIEW', { req, actorId: req.user.id, role: 'doctor', detail: { patientId } });
    activity.log('Records', `${req.user.name} opened the medical record of ${patient.full_name}. Logged, and the patient is told`, 'document');
    notify.push(patientId, { kind: 'record_viewed', title: 'Your medical record was opened', body: `${req.user.name} viewed your record.`, link: '/record.html', dedupeKey: `recview:${req.user.id}:${new Date().toISOString().slice(0, 10)}` });
    res.json(await buildRecord(patientId, { role: 'doctor', id: req.user.id }));
  }));

  // ----- allergies and conditions (patient only) -----
  r.post('/records/history', auth('patient'), h(async (req, res) => {
    const b = req.body || {};
    const kind = b.kind;
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const note = String(b.note || '').trim().slice(0, 200);
    if (kind !== 'allergy' && kind !== 'condition') return res.status(400).json({ error: 'Choose allergy or condition.' });
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter a name between 2 and 80 characters.' });
    const severity = kind === 'allergy' && SEVERITIES.includes(b.severity) ? b.severity : null;
    const count = await supabase.from('medical_history').select('id', { count: 'exact', head: true }).eq('patient_id', req.user.id);
    if ((count.count || 0) >= MAX_ENTRIES) return res.status(409).json({ error: `You can keep up to ${MAX_ENTRIES} entries. Remove one first.` });
    const id = uid('MH');
    const ins = await supabase.from('medical_history').insert({ id, patient_id: req.user.id, kind, name, note, severity });
    if (ins.error) {
      if (ins.error.code === '23505') return res.status(409).json({ error: `${name} is already in your record.` });
      throw new Error(ins.error.message);
    }
    audit('RECORD_ADD', { req, actorId: req.user.id, role: 'patient', detail: { kind, id } });
    activity.log('Records', `${req.user.name} added ${kind === 'allergy' ? 'an allergy' : 'a condition'} to their medical record`, 'document');
    res.json({ id, kind, name, note, severity });
  }));

  r.delete('/records/history/:id', auth('patient'), h(async (req, res) => {
    const del = await supabase.from('medical_history').delete().eq('id', String(req.params.id).slice(0, 40)).eq('patient_id', req.user.id).select('id, kind');
    if (del.error) throw new Error(del.error.message);
    if (!del.data || !del.data.length) return res.status(404).json({ error: 'Entry not found.' });
    audit('RECORD_REMOVE', { req, actorId: req.user.id, role: 'patient', detail: { kind: del.data[0].kind, id: del.data[0].id } });
    res.json({ removed: true });
  }));

  // ----- reports (patient uploads; the file goes in storage/records) -----
  r.post('/records/reports', auth('patient'), express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h(async (req, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'No file received.' });
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'File is too large. The limit is 10 MB.' });
    const dec = (k, max) => { try { return decodeURIComponent(String(req.headers[k] || '')).trim().slice(0, max); } catch { return ''; } };
    const filename = path.basename(dec('x-file-name', 200)).replace(/[^\w.\- ()]/g, '_').slice(0, 90) || 'report';
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (!TYPES[ext]) return res.status(400).json({ error: 'This file type is not allowed. Use JPG, PNG, WEBP, GIF, PDF, TXT, DOC or DOCX.' });
    if (!looksRight(ext, body)) return res.status(400).json({ error: 'The file content does not match its type. Please choose the original file.' });
    const title = dec('x-report-title', 80) || filename;
    const dateStr = dec('x-report-date', 10);
    let reportDate = null;
    if (dateStr) {
      const d = new Date(dateStr + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(d) || d.toISOString().slice(0, 10) !== dateStr || d.getTime() > Date.now() + 86400000) return res.status(400).json({ error: 'That report date is not valid.' });
      reportDate = dateStr;
    }
    const count = await supabase.from('record_reports').select('id', { count: 'exact', head: true }).eq('patient_id', req.user.id);
    if ((count.count || 0) >= MAX_REPORTS) return res.status(409).json({ error: `You can keep up to ${MAX_REPORTS} reports. Remove one first.` });

    const id = uid('REP');
    const fileName = id + '.' + ext;
    fs.writeFileSync(path.join(DIR, fileName), body);
    const ins = await supabase.from('record_reports').insert({ id, patient_id: req.user.id, title, filename, mime: TYPES[ext], size: body.length, file_path: fileName, report_date: reportDate });
    if (ins.error) { try { fs.unlinkSync(path.join(DIR, fileName)); } catch {} throw new Error(ins.error.message); }
    audit('REPORT_ADD', { req, actorId: req.user.id, role: 'patient', detail: { id, filename, size: body.length } });
    activity.log('Records', `${req.user.name} added the report "${title}" to their medical record (${Math.round(body.length / 1024)} KB)`, 'document');
    res.json({ id, title, filename, mime: TYPES[ext], size: body.length, reportDate });
  }));

  // The patient, or a doctor who may see this patient's record.
  r.get('/records/reports/:id/file', auth(), h(async (req, res) => {
    const q = await supabase.from('record_reports').select('id, patient_id, filename, mime, file_path').eq('id', String(req.params.id).slice(0, 40)).maybeSingle();
    const row = q.data;
    let allowed = false;
    if (row) allowed = req.user.role === 'patient' ? row.patient_id === req.user.id : req.user.role === 'doctor' && (await doctorMayView(req.user.id, row.patient_id));
    if (!allowed) {
      if (row && req.user.role === 'doctor') audit('RECORD_DENIED', { req, actorId: req.user.id, role: 'doctor', detail: { patientId: row.patient_id, reportId: row.id } });
      return res.status(404).json({ error: 'File not found.' });
    }
    const file = filePathOf(row);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File is missing on the server.' });
    if (req.user.role === 'doctor') audit('RECORD_FILE_VIEW', { req, actorId: req.user.id, role: 'doctor', detail: { patientId: row.patient_id, reportId: row.id } });
    const dl = req.query.download === '1';
    res.setHeader('Content-Type', row.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    fs.createReadStream(file).pipe(res);
  }));

  r.delete('/records/reports/:id', auth('patient'), h(async (req, res) => {
    const del = await supabase.from('record_reports').delete().eq('id', String(req.params.id).slice(0, 40)).eq('patient_id', req.user.id).select('id, file_path');
    if (del.error) throw new Error(del.error.message);
    if (!del.data || !del.data.length) return res.status(404).json({ error: 'Report not found.' });
    try { fs.unlinkSync(filePathOf(del.data[0])); } catch {}
    audit('REPORT_REMOVE', { req, actorId: req.user.id, role: 'patient', detail: { id: del.data[0].id } });
    res.json({ removed: true });
  }));

  r.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'File is too large. The limit is 10 MB.' });
    next(err);
  });
  return r;
}

module.exports = { buildRecordsRouter, doctorMayView, buildRecord };
