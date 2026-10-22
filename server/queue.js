// PASTE AS: server/queue.js  Day 9: "your turn" alert. (replaces the old file)
// Day 6: waiting queue. When a doctor is busy, a patient joins a queue instead of being rejected.
// When the doctor ends the call, the first waiting patient gets a live "Doctor is ready. Join now" alert.
// They have TURN_SECONDS to press Join now. If they do not, the next patient is called.
// Fairness and safety rules live in the database (supabase/day6.sql): one active queue per patient, one patient called per doctor.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { uid } = db;
const { supabase } = require('./supabase');
const activity = require('./activity');
const { audit } = require('./security');
const notify = require('./notify');

const TURN_SECONDS = 120;       // time the called patient has to press "Join now"
const MAX_QUEUE = 10;           // patients allowed to wait for one doctor
const STALE_BOOKED_MIN = 10;    // an accepted request nobody joined stops counting as "busy" after this long
const SWEEP_MS = 10000;

let io = null;
const setIo = (x) => { io = x; };
const emitUser = (id, ev, payload) => { if (io) io.to('user:' + id).emit(ev, payload); };

function must(res) {
  if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; }
  return res.data;
}
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ACTIVE = ['waiting', 'notified'];

// ---------- Is the doctor busy? ----------
// Busy = a call is running, or an accepted request is waiting for its patient to join, or someone is already queued / being called.
async function stateMap(onlyDoctorId) {
  const since = new Date(Date.now() - STALE_BOOKED_MIN * 60000).toISOString();
  const f = (q) => (onlyDoctorId ? q.eq('doctor_id', onlyDoctorId) : q);
  const [ip, bk, act] = await Promise.all([
    f(supabase.from('appointments').select('doctor_id').eq('status', 'in_progress')),
    f(supabase.from('appointments').select('doctor_id').eq('status', 'booked').is('slot_id', null).gt('created_at', since)),
    f(supabase.from('queue_entries').select('doctor_id').in('status', ACTIVE))
  ]);
  const map = new Map();
  const get = (id) => { if (!map.has(id)) map.set(id, { inCall: false, waiting: 0 }); return map.get(id); };
  for (const x of must(ip) || []) get(x.doctor_id).inCall = true;
  for (const x of must(bk) || []) get(x.doctor_id).inCall = true;
  for (const x of must(act) || []) get(x.doctor_id).waiting++;
  return map;
}
async function stateOf(doctorId) {
  const s = (await stateMap(doctorId)).get(doctorId);
  return s || { inCall: false, waiting: 0 };
}
async function shouldQueue(doctorId) { const s = await stateOf(doctorId); return s.inCall || s.waiting > 0; }

async function activeEntries(doctorId) {
  return must(await supabase.from('queue_entries').select('id, patient_id, symptoms, status, created_at, notified_at')
    .eq('doctor_id', doctorId).in('status', ACTIVE).order('created_at').order('id')) || [];
}
const secondsLeft = (e) => (e.status === 'notified' && e.notified_at ? Math.max(0, Math.round(TURN_SECONDS - (Date.now() - new Date(e.notified_at).getTime()) / 1000)) : null);

// Tells every patient who is waiting their new position, tells the doctor to refresh, and tells everyone the doctor's busy state.
async function broadcast(doctorId) {
  if (!io) return;
  const [act, st] = await Promise.all([activeEntries(doctorId), stateOf(doctorId)]);
  act.forEach((e, i) => emitUser(e.patient_id, 'queue:update', { queueId: e.id, doctorId, status: e.status, position: i + 1, secondsLeft: secondsLeft(e) }));
  emitUser(doctorId, 'queue:changed', { waiting: act.length });
  io.emit('queue:state', { doctorId, busy: st.inCall || st.waiting > 0, waiting: st.waiting });
}

// ---------- Joining ----------
async function enqueue(user, doc, symptoms) {
  if (await db.hasPendingRequest(user.id, doc.id)) return { error: 'You already have a pending request with this doctor.' };
  const act = await activeEntries(doc.id);
  if (act.length >= MAX_QUEUE) return { error: `${doc.full_name}'s queue is full (${MAX_QUEUE} patients). Please try again later or choose another doctor.` };
  const id = uid('QUE');
  const ins = await supabase.from('queue_entries').insert({ id, patient_id: user.id, doctor_id: doc.id, symptoms: String(symptoms || '').slice(0, 300) });
  if (ins.error) {
    if (ins.error.code === '23505') return { error: 'You are already in a waiting queue. Leave it first if you want to join another.' };
    throw new Error(ins.error.message);
  }
  activity.log('Queue', `${user.name} joined the waiting queue for ${doc.full_name} (the doctor is busy)`, 'request');
  audit('QUEUE_JOIN', { actorId: user.id, role: 'patient', detail: { queueId: id, doctorId: doc.id } });
  await promoteNext(doc.id);       // if the doctor became free a moment ago, call the first patient straight away
  await broadcast(doc.id);
  const now = (await activeEntries(doc.id));
  const idx = now.findIndex((e) => e.id === id);
  return { queueId: id, doctorId: doc.id, doctorName: doc.full_name, position: idx + 1, status: idx >= 0 ? now[idx].status : 'waiting', secondsLeft: idx >= 0 ? secondsLeft(now[idx]) : null };
}

// ---------- Calling the next patient ----------
async function promoteNext(doctorId) {
  const st = await stateOf(doctorId);
  if (st.inCall) return null;
  const act = await activeEntries(doctorId);
  if (!act.length || act.some((e) => e.status === 'notified')) return null;
  const first = act[0];
  const upd = await supabase.from('queue_entries').update({ status: 'notified', notified_at: new Date().toISOString() }).eq('id', first.id).eq('status', 'waiting').select('id');
  if (upd.error) { if (upd.error.code === '23505') return null; throw new Error(upd.error.message); }
  if (!upd.data || !upd.data.length) return null;
  const doc = await db.getDoctor(doctorId);
  emitUser(first.patient_id, 'queue:turn', { queueId: first.id, doctorId, doctorName: doc ? doc.full_name : 'Your doctor', seconds: TURN_SECONDS });
  notify.push(first.patient_id, { kind: 'queue_turn', title: 'Doctor is ready. Join now', body: `${doc ? doc.full_name : 'Your doctor'} is free. You have ${TURN_SECONDS / 60} minutes to join before the next patient is called.`, link: '/patient.html', dedupeKey: 'turn:' + first.id });
  const u = await db.getUserById(first.patient_id);
  activity.log('Queue', `${doc ? doc.full_name : 'Doctor'} is free. ${u ? u.full_name : 'The first patient'} was alerted: "Doctor is ready. Join now" (${TURN_SECONDS}s to join)`, 'request');
  audit('QUEUE_CALLED', { actorId: first.patient_id, role: 'patient', detail: { queueId: first.id, doctorId } });
  await broadcast(doctorId);
  return first.id;
}

// Called from sockets.js the moment a doctor ends a call.
async function onCallEnded(doctorId) {
  await promoteNext(doctorId);
  await broadcast(doctorId);
}

// Doctor went offline: nobody can be served, so the queue is cleared and everyone is told.
async function clearQueue(doctorId, why) {
  const rows = must(await supabase.from('queue_entries').update({ status: 'removed' }).eq('doctor_id', doctorId).in('status', ACTIVE).select('id, patient_id')) || [];
  rows.forEach((e) => emitUser(e.patient_id, 'queue:update', { queueId: e.id, doctorId, status: 'removed', reason: why || 'offline' }));
  if (rows.length) { activity.log('Queue', `Queue cleared (${rows.length} patient(s) told): ${why || 'doctor went offline'}`, 'request'); await broadcast(doctorId); }
}

// Runs every 10 seconds: expires patients who did not join in time and calls the next one. Also recovers after a server restart.
async function sweep() {
  const cutoff = new Date(Date.now() - TURN_SECONDS * 1000).toISOString();
  const expired = must(await supabase.from('queue_entries').update({ status: 'expired' }).eq('status', 'notified').lt('notified_at', cutoff).select('id, patient_id, doctor_id')) || [];
  const doctors = new Set(expired.map((e) => e.doctor_id));
  for (const e of expired) {
    emitUser(e.patient_id, 'queue:update', { queueId: e.id, doctorId: e.doctor_id, status: 'expired' });
    activity.log('Queue', `A called patient did not join within ${TURN_SECONDS}s. Turn passed to the next patient`, 'request');
  }
  const waiting = must(await supabase.from('queue_entries').select('doctor_id').eq('status', 'waiting')) || [];
  waiting.forEach((w) => doctors.add(w.doctor_id));
  for (const d of doctors) {
    const called = await promoteNext(d);
    if (!called && expired.some((e) => e.doctor_id === d)) await broadcast(d);
  }
}
function start(ioInstance) {
  setIo(ioInstance);
  const t = setInterval(() => sweep().catch((e) => console.error('Queue sweep error:', e.message)), SWEEP_MS);
  if (t.unref) t.unref();
}

// ---------- HTTP routes ----------
function buildQueueRouter(ioInstance) {
  setIo(ioInstance);
  const { verifyToken } = require('./routes');      // loaded here (not at the top) to avoid a circular import
  const auth = (role) => (req, res, next) => {
    const hd = req.headers.authorization || '';
    const user = verifyToken(hd.startsWith('Bearer ') ? hd.slice(7) : '');
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    if (role && user.role !== role) return res.status(403).json({ error: `This action is for ${role}s only.` });
    req.user = user; next();
  };
  const r = express.Router();

  // Patient: where am I in the queue right now? (used after a page refresh)
  r.get('/queue/mine', auth('patient'), h(async (req, res) => {
    const e = must(await supabase.from('queue_entries').select('id, doctor_id, status, notified_at, created_at').eq('patient_id', req.user.id).in('status', ACTIVE).maybeSingle());
    if (!e) return res.json({ entry: null });
    const act = await activeEntries(e.doctor_id);
    const doc = await db.getDoctor(e.doctor_id);
    res.json({ entry: { queueId: e.id, doctorId: e.doctor_id, doctorName: doc ? doc.full_name : '', status: e.status, position: act.findIndex((x) => x.id === e.id) + 1, secondsLeft: secondsLeft(e) } });
  }));

  // Patient: leave the queue
  r.post('/queue/:id/leave', auth('patient'), h(async (req, res) => {
    const rows = must(await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', String(req.params.id).slice(0, 40)).eq('patient_id', req.user.id).in('status', ACTIVE).select('id, doctor_id, notified_at'));
    if (!rows || !rows.length) return res.status(404).json({ error: 'You are not in this queue any more.' });
    activity.log('Queue', `${req.user.name} left the queue`, 'request');
    audit('QUEUE_LEAVE', { req, actorId: req.user.id, role: 'patient', detail: { queueId: rows[0].id, doctorId: rows[0].doctor_id } });
    await promoteNext(rows[0].doctor_id);
    await broadcast(rows[0].doctor_id);
    res.json({ left: true });
  }));

  // Patient: "Join now" after the alert. Creates the appointment and room, exactly like an accepted request.
  r.post('/queue/:id/join', auth('patient'), h(async (req, res) => {
    const id = String(req.params.id).slice(0, 40);
    const e = must(await supabase.from('queue_entries').select('*').eq('id', id).eq('patient_id', req.user.id).maybeSingle());
    if (!e || e.status !== 'notified') return res.status(409).json({ error: 'It is not your turn yet, or your turn has passed.' });
    if (Date.now() - new Date(e.notified_at).getTime() > (TURN_SECONDS + 15) * 1000) return res.status(409).json({ error: 'Your turn has passed. Please join the queue again.' });
    const took = must(await supabase.from('queue_entries').update({ status: 'joined' }).eq('id', id).eq('status', 'notified').select('id'));
    if (!took || !took.length) return res.status(409).json({ error: 'Your turn has passed. Please join the queue again.' });
    const doc = await db.getDoctor(e.doctor_id);
    const apptId = uid('APT'), room = crypto.randomBytes(12).toString('hex');
    const ins = await supabase.from('appointments').insert({ id: apptId, patient_id: req.user.id, doctor_id: e.doctor_id, room_id: room, fee: doc.fee });
    if (ins.error) {
      await supabase.from('queue_entries').update({ status: 'notified' }).eq('id', id);
      throw new Error(ins.error.message);
    }
    await supabase.from('queue_entries').update({ appointment_id: apptId }).eq('id', id);
    emitUser(e.doctor_id, 'appointment:new', { appointmentId: apptId, patientName: req.user.name, fromQueue: true });
    activity.log('Queue', `${req.user.name} pressed Join now. Appointment ${apptId} created. Private room ${room.slice(0, 8)}... generated. Fee Rs ${doc.fee} read from the database`, 'appointment');
    audit('QUEUE_JOINED_CALL', { req, actorId: req.user.id, role: 'patient', detail: { queueId: id, appointmentId: apptId, doctorId: e.doctor_id } });
    await broadcast(e.doctor_id);
    res.json({ appointmentId: apptId });
  }));

  // Doctor: see the queue
  r.get('/doctor/queue', auth('doctor'), h(async (req, res) => {
    const act = await activeEntries(req.user.id);
    const users = act.length ? must(await supabase.from('users').select('id, full_name').in('id', act.map((x) => x.patient_id))) || [] : [];
    const name = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
    const out = [];
    for (let i = 0; i < act.length; i++) {
      const x = act[i];
      out.push({ id: x.id, position: i + 1, patientName: name[x.patient_id] || '', symptoms: x.symptoms || '', status: x.status, secondsLeft: secondsLeft(x), patientLanguages: await db.getLanguages(x.patient_id), createdAt: x.created_at });
    }
    res.json(out);
  }));

  // Doctor: remove someone from the queue
  r.post('/queue/:id/remove', auth('doctor'), h(async (req, res) => {
    const rows = must(await supabase.from('queue_entries').update({ status: 'removed' }).eq('id', String(req.params.id).slice(0, 40)).eq('doctor_id', req.user.id).in('status', ACTIVE).select('id, patient_id'));
    if (!rows || !rows.length) return res.status(404).json({ error: 'That patient is not in your queue any more.' });
    emitUser(rows[0].patient_id, 'queue:update', { queueId: rows[0].id, doctorId: req.user.id, status: 'removed', reason: 'doctor' });
    activity.log('Queue', `${req.user.name} removed a patient from the queue`, 'request');
    audit('QUEUE_REMOVE', { req, actorId: req.user.id, role: 'doctor', detail: { queueId: rows[0].id } });
    await promoteNext(req.user.id);
    await broadcast(req.user.id);
    res.json({ removed: true });
  }));

  return r;
}

module.exports = { setIo, start, buildQueueRouter, shouldQueue, enqueue, broadcast, onCallEnded, clearQueue, stateMap, promoteNext, sweep, TURN_SECONDS };
