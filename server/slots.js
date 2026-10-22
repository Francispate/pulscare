// PASTE AS: server/slots.js  Day 11: slots of a disabled doctor cannot be seen or booked. Day 9: booking and cancellation alerts. (replaces the old file)
// Day 5: doctor working hours, bookable slots, booking and cancelling.
// All times a person sees are Indian Standard Time (IST, UTC+5:30). The database stores real moments in time (UTC).
// Double booking is stopped inside the database (see supabase/04_slots.sql: book_slot), not here, so two patients clicking at
// the same instant can never both win.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { uid } = db;
const { supabase } = require('./supabase');
const activity = require('./activity');
const { audit } = require('./security');
const { verifyToken } = require('./routes');
const notify = require('./notify');

const WINDOW_DAYS = 7;                       // patients can book up to 7 days ahead (today included)
const IST_MS = 330 * 60000;
const SLOT_LENGTHS = [5, 10, 15, 20, 30, 45, 60];
const DEFAULTS = { days: '1,2,3,4,5', start_time: '09:00', end_time: '17:00', slot_minutes: 15 };

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function must(res) {
  if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; }
  return res.data;
}

// ---------- IST date helpers ----------
const istDate = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);                  // "2026-10-16"
const noon = (d) => new Date(d + 'T12:00:00Z');
const dayOfWeek = (d) => noon(d).getUTCDay();                                               // 0 = Sunday
const addDays = (d, n) => new Date(noon(d).getTime() + n * 86400000).toISOString().slice(0, 10);
const toUtc = (d, hhmm) => new Date(`${d}T${hhmm}:00+05:30`);
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n) => String(n).padStart(2, '0');

// The slots one working day would have (pure function, easy to test). Past times are skipped.
function buildCandidates(date, s, nowMs) {
  const days = String(s.days).split(',').filter(Boolean).map(Number);
  if (!days.includes(dayOfWeek(date))) return [];
  const len = Number(s.slot_minutes), out = [];
  for (let m = toMin(s.start_time); m + len <= toMin(s.end_time); m += len) {
    const start = toUtc(date, `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    if (start.getTime() <= nowMs) continue;
    out.push({ start, end: new Date(start.getTime() + len * 60000) });
  }
  return out;
}

// ---------- Working hours ----------
async function getSchedule(doctorId) {
  // First time a doctor is looked at, a sensible default is stored (Mon to Fri, 09:00 to 17:00, 15 minutes).
  must(await supabase.from('doctor_schedule').upsert({ doctor_id: doctorId, ...DEFAULTS }, { onConflict: 'doctor_id', ignoreDuplicates: true }));
  return must(await supabase.from('doctor_schedule').select('*').eq('doctor_id', doctorId).maybeSingle());
}
const apiSchedule = (r) => ({ days: String(r.days).split(',').filter(Boolean).map(Number), start: r.start_time, end: r.end_time, slotMinutes: r.slot_minutes });

function parseSchedule(b) {
  b = b || {};
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  const start = String(b.start || ''), end = String(b.end || ''), len = Number(b.slotMinutes);
  if (!days.length) return { error: 'Choose at least one working day.' };
  if (!re.test(start) || !re.test(end)) return { error: 'Enter start and end times like 09:00.' };
  if (toMin(end) <= toMin(start)) return { error: 'The end time must be after the start time.' };
  if (!SLOT_LENGTHS.includes(len)) return { error: 'Choose a slot length from the list.' };
  if (toMin(end) - toMin(start) < len) return { error: 'Working hours are shorter than one slot.' };
  if ((toMin(end) - toMin(start)) / len > 96) return { error: 'That would make more than 96 slots a day. Use longer slots or shorter hours.' };
  return { row: { days: days.join(','), start_time: start, end_time: end, slot_minutes: len } };
}

// Creates the slots for the next 7 days.
//  replaceFree = true : doctor just saved new hours. Free future slots are removed and rebuilt. Booked slots are never touched.
//  replaceFree = false: lazy top-up. Only days that have no slots at all get filled (so a new day appears each morning).
async function generateSlots(doctorId, { replaceFree }) {
  const s = await getSchedule(doctorId);
  const now = Date.now();
  if (replaceFree) {
    must(await supabase.from('doctor_slots').delete().eq('doctor_id', doctorId).is('patient_id', null).gt('starts_at', new Date(now).toISOString()));
  }
  const today = istDate(now);
  const from = toUtc(today, '00:00').toISOString(), to = toUtc(addDays(today, WINDOW_DAYS), '00:00').toISOString();
  const existing = must(await supabase.from('doctor_slots').select('starts_at, ends_at').eq('doctor_id', doctorId).gte('starts_at', from).lt('starts_at', to)) || [];
  const busyDays = new Set(existing.map((x) => istDate(new Date(x.starts_at).getTime())));
  const busy = existing.map((x) => [new Date(x.starts_at).getTime(), new Date(x.ends_at).getTime()]);
  const rows = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = addDays(today, i);
    if (!replaceFree && busyDays.has(d)) continue;
    for (const c of buildCandidates(d, s, now)) {
      const a = c.start.getTime(), b = c.end.getTime();
      if (busy.some(([x, y]) => a < y && b > x)) continue;         // never overlap a slot that is already booked
      rows.push({ id: 'SLT-' + crypto.randomBytes(5).toString('hex').toUpperCase(), doctor_id: doctorId, starts_at: c.start.toISOString(), ends_at: c.end.toISOString() });
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    must(await supabase.from('doctor_slots').upsert(rows.slice(i, i + 200), { onConflict: 'doctor_id,starts_at', ignoreDuplicates: true }));
  }
  return rows.length;
}

function auth(role) {
  return (req, res, next) => {
    const hd = req.headers.authorization || '';
    const user = verifyToken(hd.startsWith('Bearer ') ? hd.slice(7) : '');
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    if (role && user.role !== role) return res.status(403).json({ error: `This action is for ${role}s only.` });
    req.user = user; next();
  };
}

function buildSlotRouter(io) {
  const r = express.Router();

  // ---------- Patient (and doctor) view: a doctor's slots for the next 7 days ----------
  r.get('/doctors/:id/slots', auth(), h(async (req, res) => {
    const doc = await db.getDoctor(String(req.params.id).slice(0, 40));
    if (!doc || doc.disabled) return res.status(404).json({ error: 'Doctor not found.' });
    await generateSlots(doc.id, { replaceFree: false });
    const nowMs = Date.now();
    const to = toUtc(addDays(istDate(nowMs), WINDOW_DAYS), '00:00').toISOString();
    const rows = must(await supabase.from('doctor_slots').select('id, starts_at, ends_at, patient_id')
      .eq('doctor_id', doc.id).gt('starts_at', new Date(nowMs).toISOString()).lt('starts_at', to).order('starts_at')) || [];
    const byDate = new Map();
    for (const x of rows) {
      const d = istDate(new Date(x.starts_at).getTime());
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push({ id: x.id, startsAt: x.starts_at, endsAt: x.ends_at, booked: !!x.patient_id, mine: x.patient_id === req.user.id });
    }
    const sched = await getSchedule(doc.id);
    res.json({ doctorId: doc.id, doctorName: doc.full_name, slotMinutes: sched.slot_minutes, days: [...byDate].map(([date, slots]) => ({ date, slots })) });
  }));

  // ---------- Doctor: working hours ----------
  r.get('/doctor/schedule', auth('doctor'), h(async (req, res) => {
    res.json({ schedule: apiSchedule(await getSchedule(req.user.id)) });
  }));

  r.put('/doctor/schedule', auth('doctor'), h(async (req, res) => {
    const p = parseSchedule(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    must(await supabase.from('doctor_schedule').upsert({ doctor_id: req.user.id, ...p.row, updated_at: new Date().toISOString() }, { onConflict: 'doctor_id' }));
    const created = await generateSlots(req.user.id, { replaceFree: true });
    io.emit('slot:update', { doctorId: req.user.id });
    audit('SCHEDULE_SAVE', { req, actorId: req.user.id, role: 'doctor', detail: { ...p.row, slotsCreated: created } });
    activity.log('Slots', `${req.user.name} saved working hours ${p.row.start_time}-${p.row.end_time}, ${p.row.slot_minutes} min slots. ${created} free slots created for the next ${WINDOW_DAYS} days`, 'appointment');
    res.json({ schedule: apiSchedule(await getSchedule(req.user.id)), slotsCreated: created });
  }));

  // ---------- Doctor: upcoming booked slots ----------
  r.get('/doctor/slots', auth('doctor'), h(async (req, res) => {
    const nowIso = new Date().toISOString();
    const rows = must(await supabase.from('doctor_slots').select('id, starts_at, ends_at, patient_id')
      .eq('doctor_id', req.user.id).not('patient_id', 'is', null).gt('ends_at', nowIso).order('starts_at')) || [];
    let names = {}, appts = {};
    if (rows.length) {
      const users = must(await supabase.from('users').select('id, full_name').in('id', [...new Set(rows.map((x) => x.patient_id))])) || [];
      names = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
      const as = must(await supabase.from('appointments').select('id, slot_id, reason, status').in('slot_id', rows.map((x) => x.id))) || [];
      appts = Object.fromEntries(as.map((a) => [a.slot_id, a]));
    }
    const free = await supabase.from('doctor_slots').select('id', { count: 'exact', head: true }).eq('doctor_id', req.user.id).is('patient_id', null).gt('starts_at', nowIso);
    res.json({
      freeCount: free.count || 0,
      booked: rows.map((x) => ({
        slotId: x.id, startsAt: x.starts_at, endsAt: x.ends_at, patientId: x.patient_id, patientName: names[x.patient_id] || '',
        appointmentId: appts[x.id] ? appts[x.id].id : null, reason: appts[x.id] ? appts[x.id].reason : '', status: appts[x.id] ? appts[x.id].status : null
      }))
    });
  }));

  // ---------- Patient: book a slot ----------
  r.post('/slots/:id/book', auth('patient'), h(async (req, res) => {
    const slotId = String(req.params.id).slice(0, 40);
    const reason = String((req.body || {}).reason || '').trim().slice(0, 300);
    const apptId = uid('APT');
    const room = crypto.randomBytes(12).toString('hex');
    const pre = await supabase.from('doctor_slots').select('doctor_id').eq('id', slotId).maybeSingle();
    if (pre.data && db.isDisabled(pre.data.doctor_id)) return res.status(409).json({ error: 'This doctor is not available. Please choose another doctor.' });
    const { error } = await supabase.rpc('book_slot', { p_slot_id: slotId, p_patient_id: req.user.id, p_appt_id: apptId, p_room: room, p_reason: reason });
    if (error) {
      const m = error.message || '';
      if (/SLOT_TAKEN_OR_PAST/.test(m) || error.code === '23505') {
        audit('SLOT_BOOK_REJECTED', { req, actorId: req.user.id, role: 'patient', detail: { slotId, why: 'taken or past' } });
        activity.log('Slots', `${req.user.name} tried to book slot ${slotId} but it was already taken. The database allowed only one booking`, 'appointment');
        return res.status(409).json({ code: 'SLOT_TAKEN', error: 'Sorry, that slot was just taken or has already passed. Please pick another one.' });
      }
      if (/PATIENT_BUSY/.test(m)) return res.status(409).json({ code: 'PATIENT_BUSY', error: 'You already have a booking that overlaps this time. Pick a different time.' });
      throw new Error(m);
    }
    const slot = must(await supabase.from('doctor_slots').select('id, doctor_id, starts_at, ends_at').eq('id', slotId).maybeSingle());
    const doc = await db.getDoctor(slot.doctor_id);
    io.to('user:' + slot.doctor_id).emit('slot:booked', { slotId, startsAt: slot.starts_at, patientName: req.user.name, appointmentId: apptId });
    io.emit('slot:update', { doctorId: slot.doctor_id });
    notify.push(slot.doctor_id, { kind: 'slot_booked', title: 'New booking', body: `${req.user.name} booked ${new Date(slot.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`, link: '/doctor.html', dedupeKey: 'book:' + apptId });
    audit('SLOT_BOOK', { req, actorId: req.user.id, role: 'patient', detail: { slotId, doctorId: slot.doctor_id, appointmentId: apptId, startsAt: slot.starts_at } });
    activity.log('Slots', `${req.user.name} booked ${doc.full_name} for ${new Date(slot.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST. Appointment ${apptId} created`, 'appointment');
    res.json({ appointmentId: apptId, slotId, startsAt: slot.starts_at, endsAt: slot.ends_at, doctorName: doc.full_name });
  }));

  // ---------- Patient or doctor: cancel a booked slot (only before it starts) ----------
  r.post('/slots/:id/cancel', auth(), h(async (req, res) => {
    const slotId = String(req.params.id).slice(0, 40);
    const { data, error } = await supabase.rpc('cancel_slot', { p_slot_id: slotId, p_actor_id: req.user.id });
    if (error) {
      const m = error.message || '';
      if (/NO_SLOT/.test(m)) return res.status(404).json({ error: 'Slot not found.' });
      if (/NOT_BOOKED/.test(m)) return res.status(409).json({ error: 'This slot is not booked.' });
      if (/NOT_ALLOWED/.test(m)) return res.status(403).json({ error: 'This is not your booking.' });
      if (/ALREADY_STARTED/.test(m)) return res.status(409).json({ error: 'This visit has already started, so it can no longer be cancelled.' });
      throw new Error(m);
    }
    const other = req.user.id === data.doctor_id ? data.patient_id : data.doctor_id;
    io.to('user:' + other).emit('slot:cancelled', { startsAt: data.starts_at, by: req.user.role });
    io.emit('slot:update', { doctorId: data.doctor_id });
    notify.push(other, { kind: 'slot_cancelled', title: 'Booking cancelled', body: `${req.user.name} cancelled the ${new Date(data.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST visit`, link: other === data.doctor_id ? '/doctor.html' : '/patient.html', dedupeKey: data.appointment_id ? 'cancel:' + data.appointment_id : null });
    audit('SLOT_CANCEL', { req, actorId: req.user.id, role: req.user.role, detail: { slotId, doctorId: data.doctor_id, patientId: data.patient_id, appointmentId: data.appointment_id } });
    activity.log('Slots', `${req.user.name} cancelled the booking for ${new Date(data.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`, 'appointment');
    res.json({ cancelled: true });
  }));

  return r;
}

module.exports = { buildSlotRouter, buildCandidates, parseSchedule, istDate, addDays, toUtc };
