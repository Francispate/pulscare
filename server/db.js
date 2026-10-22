// PASTE AS: server/db.js  Day 11: disabled doctors are hidden from patients and tracked in memory. (replaces the old file)
// Day 8: PDF fingerprints (file_sha256) are saved with each document.
// Day 5: appointments now carry their slot time (slot_starts_at / slot_ends_at). Day 3: all database access now goes to Supabase. Every function here is async, so callers use "await".
// Nothing outside this file talks to the database directly.
const { supabase } = require('./supabase');

const uid = (p) =>
  p + '-' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-3).toUpperCase();

function must(res) {
  if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; }
  return res.data;
}
const T = (name) => supabase.from(name);
const maybe = async (q) => must(await q.maybeSingle());
const list = async (q) => must(await q) || [];
const csv = (s) => String(s || '').split(',').filter(Boolean);
const uniq = (a) => [...new Set(a)];

// ---------------- Users ----------------
const getUserById = (id) => maybe(T('users').select('*').eq('id', id));
const getPatientByEmail = (email) => maybe(T('users').select('*').eq('email', email).eq('role', 'patient'));
const getDoctorUser = (id) => maybe(T('users').select('*').eq('id', id).eq('role', 'doctor'));
async function emailExists(email) { return !!(await maybe(T('users').select('id').eq('email', email))); }

async function createPatient({ id, fullName, email, passwordHash, phone, language }) {
  must(await T('users').insert({ id, role: 'patient', full_name: fullName, email, password_hash: passwordHash, phone: phone || '', preferred_language: language }));
  return getUserById(id);
}

async function getLanguages(id) {
  const row = await maybe(T('users').select('languages').eq('id', id));
  return row ? csv(row.languages) : [];
}
async function setLanguages(id, joined) { must(await T('users').update({ languages: joined }).eq('id', id)); }

// ---------------- Doctors ----------------
async function listDoctors() {
  const docs = await list(T('doctors').select('*').eq('disabled', false).order('id')); // disabled doctors are hidden from patients
  const users = docs.length ? await list(T('users').select('id, full_name, languages').in('id', docs.map((d) => d.id))) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return docs.map((d) => ({
    id: d.id, name: byId[d.id] ? byId[d.id].full_name : '', department: d.department, qualification: d.qualification,
    about: d.about, fee: d.fee, online: !!d.is_online, languages: csv(byId[d.id] && byId[d.id].languages)
  }));
}
async function getDoctor(id) { // doctor row + full_name
  const d = await maybe(T('doctors').select('*').eq('id', id));
  if (!d) return null;
  const u = await getUserById(id);
  return { ...d, full_name: u ? u.full_name : '' };
}
async function setDoctorOnline(id, v) { must(await T('doctors').update({ is_online: v ? 1 : 0 }).eq('id', id)); }
async function getDoctorOnline(id) { const r = await maybe(T('doctors').select('is_online').eq('id', id)); return !!(r && r.is_online); }
async function resetAllOffline() { must(await T('doctors').update({ is_online: 0 }).eq('is_online', 1)); }

// Day 11: the set of disabled doctors is kept in memory so every request can check it instantly (no database call per request).
const disabledIds = new Set();
const isDisabled = (id) => disabledIds.has(id);
function setDisabledCache(id, on) { if (on) disabledIds.add(id); else disabledIds.delete(id); }
async function refreshDisabled() {
  const rows = await list(T('doctors').select('id').eq('disabled', true));
  disabledIds.clear(); rows.forEach((r) => disabledIds.add(r.id));
  return disabledIds.size;
}

// ---------------- Consultation requests ----------------
async function hasPendingRequest(patientId, doctorId) {
  return !!(await maybe(T('consult_requests').select('id').eq('patient_id', patientId).eq('doctor_id', doctorId).eq('status', 'pending').limit(1)));
}
async function createRequest({ id, patientId, doctorId, symptoms }) {
  must(await T('consult_requests').insert({ id, patient_id: patientId, doctor_id: doctorId, symptoms }));
}
const getRequestForDoctor = (id, doctorId) => maybe(T('consult_requests').select('*').eq('id', id).eq('doctor_id', doctorId));
// Moves a request from one status to another only if it is still in the "from" status. Returns true if it moved.
async function transitionRequest(id, from, to) {
  const out = must(await T('consult_requests').update({ status: to }).eq('id', id).eq('status', from).select('id'));
  return !!(out && out.length);
}
async function pendingForDoctor(doctorId) {
  const reqs = await list(T('consult_requests').select('*').eq('doctor_id', doctorId).eq('status', 'pending').order('created_at'));
  const users = reqs.length ? await list(T('users').select('id, full_name').in('id', uniq(reqs.map((r) => r.patient_id)))) : [];
  const name = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
  return reqs.map((r) => ({ id: r.id, patientId: r.patient_id, patientName: name[r.patient_id] || '', symptoms: r.symptoms, createdAt: r.created_at }));
}

// ---------------- Appointments ----------------
const getAppointment = (id) => maybe(T('appointments').select('*').eq('id', id));
const getSlot = (id) => maybe(T('doctor_slots').select('*').eq('id', id));

async function acceptRequest(reqRow, { apptId, room, fee }) {
  if (!(await transitionRequest(reqRow.id, 'pending', 'accepted'))) return false; // someone else already handled it
  const res = await T('appointments').insert({ id: apptId, request_id: reqRow.id, patient_id: reqRow.patient_id, doctor_id: reqRow.doctor_id, room_id: room, fee });
  if (res.error) { await transitionRequest(reqRow.id, 'accepted', 'pending'); throw new Error(res.error.message); }
  return true;
}

async function decorate(appts) {
  if (!appts.length) return [];
  const ids = appts.map((a) => a.id);
  const slotIds = uniq(appts.map((a) => a.slot_id).filter(Boolean));
  const [users, docs, invs, rxs, slots] = await Promise.all([
    list(T('users').select('id, full_name').in('id', uniq(appts.flatMap((a) => [a.patient_id, a.doctor_id])))),
    list(T('doctors').select('id, department').in('id', uniq(appts.map((a) => a.doctor_id)))),
    list(T('invoices').select('appointment_id, invoice_no, file_path').in('appointment_id', ids)),
    list(T('prescriptions').select('appointment_id, file_path').in('appointment_id', ids)),
    slotIds.length ? list(T('doctor_slots').select('id, starts_at, ends_at').in('id', slotIds)) : []
  ]);
  const slotBy = Object.fromEntries(slots.map((s) => [s.id, s]));
  const name = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
  const dept = Object.fromEntries(docs.map((d) => [d.id, d.department]));
  const inv = Object.fromEntries(invs.map((i) => [i.appointment_id, i]));
  const rx = Object.fromEntries(rxs.map((r) => [r.appointment_id, r]));
  return appts.map((a) => ({
    ...a, patient_name: name[a.patient_id], doctor_name: name[a.doctor_id], department: dept[a.doctor_id],
    invoice_no: inv[a.id] ? inv[a.id].invoice_no : null,
    has_rx: !!(rx[a.id] && rx[a.id].file_path),
    has_invoice: !!(inv[a.id] && inv[a.id].file_path),
    slot_starts_at: slotBy[a.slot_id] ? slotBy[a.slot_id].starts_at : null,
    slot_ends_at: slotBy[a.slot_id] ? slotBy[a.slot_id].ends_at : null
  }));
}
async function listAppointmentsFor(role, userId) {
  const col = role === 'doctor' ? 'doctor_id' : 'patient_id';
  return decorate(await list(T('appointments').select('*').eq(col, userId).order('created_at', { ascending: false })));
}
async function getAppointmentFull(id) { const a = await getAppointment(id); return a ? (await decorate([a]))[0] : null; }
async function setAppointmentStatus(id, status) { must(await T('appointments').update({ status }).eq('id', id)); }
async function startIfBooked(id) { must(await T('appointments').update({ status: 'in_progress' }).eq('id', id).eq('status', 'booked')); }

// ---------------- Chat keys and messages ----------------
async function upsertKey(appointmentId, userId, publicKey) {
  must(await T('appointment_keys').upsert({ appointment_id: appointmentId, user_id: userId, public_key: publicKey }, { onConflict: 'appointment_id,user_id' }));
}
async function getPeerKey(appointmentId, userId) {
  const r = await maybe(T('appointment_keys').select('public_key').eq('appointment_id', appointmentId).neq('user_id', userId).limit(1));
  return r ? r.public_key : null;
}
async function insertMessage({ id, appointmentId, senderId, ciphertext, iv }) {
  must(await T('messages').insert({ id, appointment_id: appointmentId, sender_id: senderId, ciphertext, iv }));
}
async function listMessages(appointmentId) {
  const rows = await list(T('messages').select('id, sender_id, ciphertext, iv, created_at').eq('appointment_id', appointmentId).order('created_at'));
  return rows.map((m) => ({ id: m.id, senderId: m.sender_id, ciphertext: m.ciphertext, iv: m.iv, createdAt: m.created_at }));
}

// ---------------- Prescriptions ----------------
const getRx = (appointmentId) => maybe(T('prescriptions').select('*').eq('appointment_id', appointmentId));
const getRxByHash = (hash) => maybe(T('prescriptions').select('*').eq('sha256', hash));
async function saveRxDraft(appointmentId, { items, notes, diagnosis }) {
  const existing = await getRx(appointmentId);
  if (existing) must(await T('prescriptions').update({ items, notes, diagnosis }).eq('id', existing.id));
  else must(await T('prescriptions').insert({ id: 'RX-' + Math.floor(100000 + Math.random() * 900000), appointment_id: appointmentId, items, notes, diagnosis }));
}
async function setRxFile(id, sha256, filePath, issuedAt, fileSha256) { must(await T('prescriptions').update({ sha256, file_path: filePath, issued_at: issuedAt, file_sha256: fileSha256 || null }).eq('id', id)); }

// ---------------- Payments and invoices ----------------
const getPayment = (id) => maybe(T('payments').select('*').eq('id', id));
async function insertFailedPayment({ id, appointmentId, label, amount, ref, reason }) {
  must(await T('payments').insert({ id, appointment_id: appointmentId, method: label, amount, status: 'failed', txn_ref: ref, failure_reason: reason }));
}
// One database transaction (see supabase/day3.sql). Returns the new invoice number.
async function completePayment({ payId, invId, apptId, label, amount, ref }) {
  const res = await supabase.rpc('complete_payment', { p_pay_id: payId, p_inv_id: invId, p_appt_id: apptId, p_label: label, p_amount: amount, p_ref: ref });
  if (res.error) {
    const e = new Error(res.error.message);
    if (/ALREADY_PAID_OR_NOT_READY/.test(res.error.message)) e.code = 'ALREADY_PAID';
    throw e;
  }
  return res.data;
}
const getInvoiceByAppointment = (appointmentId) => maybe(T('invoices').select('*').eq('appointment_id', appointmentId));
async function setInvoiceFile(id, filePath, fileSha256) { must(await T('invoices').update({ file_path: filePath, file_sha256: fileSha256 || null }).eq('id', id)); }
// Day 8: records the fingerprint of a PDF issued before fingerprints existed (done once, on its first download).
async function setDocFileSha(table, id, fileSha256) { if (!['prescriptions', 'invoices'].includes(table)) throw new Error('bad table'); must(await T(table).update({ file_sha256: fileSha256 }).eq('id', id)); }

// ---------------- Attachments ----------------
const listAttachments = (appointmentId) => list(T('attachments').select('*').eq('appointment_id', appointmentId).order('created_at'));
async function countAttachments(appointmentId) {
  const r = await T('attachments').select('id', { count: 'exact', head: true }).eq('appointment_id', appointmentId);
  if (r.error) throw new Error(r.error.message);
  return r.count || 0;
}
async function insertAttachment(row) {
  must(await T('attachments').insert(row));
  return getAttachment(row.id);
}
const getAttachment = (id) => maybe(T('attachments').select('*').eq('id', id));
async function deleteAttachment(id) { must(await T('attachments').delete().eq('id', id)); }

module.exports = { setDocFileSha,
  uid,
  getUserById, getPatientByEmail, getDoctorUser, emailExists, createPatient, getLanguages, setLanguages,
  listDoctors, getDoctor, setDoctorOnline, getDoctorOnline, resetAllOffline, isDisabled, setDisabledCache, refreshDisabled,
  hasPendingRequest, createRequest, getRequestForDoctor, transitionRequest, pendingForDoctor,
  getAppointment, getSlot, acceptRequest, listAppointmentsFor, getAppointmentFull, setAppointmentStatus, startIfBooked,
  upsertKey, getPeerKey, insertMessage, listMessages,
  getRx, getRxByHash, saveRxDraft, setRxFile,
  getPayment, insertFailedPayment, completePayment, getInvoiceByAppointment, setInvoiceFile,
  listAttachments, countAttachments, insertAttachment, getAttachment, deleteAttachment
};
