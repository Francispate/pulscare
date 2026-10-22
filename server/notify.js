// PASTE AS: server/notify.js  (new file)
// Day 9: one place for every alert. push() saves the alert in Supabase (so it survives a reload) and sends it live to that person's open pages.
// The bell in the page header reads them from here. Alerts are private: a person can only read and mark their own.
const express = require('express');
const db = require('./db');
const { uid } = db;
const { supabase } = require('./supabase');
const activity = require('./activity');

const REMIND_MIN = 15;     // reminder goes out this many minutes before a booked slot
const SWEEP_MS = 20000;
const KEEP = 50;           // the bell shows the latest 50

let io = null;
const setIo = (x) => { io = x; };
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function must(res) { if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; } return res.data; }
const shape = (r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: !!r.read_at, createdAt: r.created_at });
const COLS = 'id, kind, title, body, link, read_at, created_at';

// Saves and delivers one alert. Never throws: a failed alert must never break the action that caused it.
// dedupeKey: the same key for the same person is only ever created once.
async function push(userId, { kind, title, body = '', link = '', dedupeKey = null }) {
  try {
    const ins = await supabase.from('notifications').insert({
      id: uid('NTF'), user_id: userId, kind, title: String(title).slice(0, 120), body: String(body).slice(0, 300), link: String(link).slice(0, 200), dedupe_key: dedupeKey
    }).select(COLS).single();
    if (ins.error) {
      if (ins.error.code !== '23505') console.error('Notification not saved:', ins.error.message);
      return null; // 23505 = already created before (duplicate)
    }
    const item = shape(ins.data);
    if (io) io.to('user:' + userId).emit('notify:new', item);
    return item;
  } catch (e) { console.error('Notification error:', e.message); return null; }
}

const istTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

// Runs every 20 seconds: reminds the patient and the doctor about a booked visit that starts within 15 minutes.
async function sweepReminders() {
  const now = Date.now();
  const slots = must(await supabase.from('doctor_slots').select('id, doctor_id, patient_id, starts_at')
    .not('patient_id', 'is', null).gt('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(now + REMIND_MIN * 60000).toISOString())) || [];
  if (!slots.length) return;
  const appts = must(await supabase.from('appointments').select('id, slot_id').in('slot_id', slots.map((s) => s.id)).eq('status', 'booked')) || [];
  const live = new Set(appts.map((a) => a.slot_id));
  for (const s of slots) {
    if (!live.has(s.id)) continue;
    const [doc, pat] = await Promise.all([db.getDoctor(s.doctor_id), db.getUserById(s.patient_id)]);
    const mins = Math.max(1, Math.round((new Date(s.starts_at).getTime() - now) / 60000));
    const when = `${istTime(s.starts_at)} IST (in about ${mins} min)`;
    const a = await push(s.patient_id, { kind: 'slot_reminder', title: 'Your visit starts soon', body: `${doc ? doc.full_name : 'Your doctor'} at ${when}. The room opens 10 minutes before.`, link: '/patient.html', dedupeKey: 'remind:' + s.id });
    const b = await push(s.doctor_id, { kind: 'slot_reminder', title: 'Visit starting soon', body: `${pat ? pat.full_name : 'A patient'} at ${when}.`, link: '/doctor.html', dedupeKey: 'remind:' + s.id });
    if (a || b) activity.log('Notifications', `Reminder sent for the ${istTime(s.starts_at)} IST visit (patient and doctor)`, 'request');
  }
}

function start(ioInstance) {
  setIo(ioInstance);
  const run = () => sweepReminders().catch((e) => console.error('Reminder sweep error:', e.message));
  const t = setInterval(run, SWEEP_MS);
  if (t.unref) t.unref();
  setTimeout(run, 3000);
}

// ---------- HTTP routes (the bell) ----------
function buildNotifyRouter(ioInstance) {
  setIo(ioInstance);
  const { verifyToken } = require('./routes');   // loaded here (not at the top) to avoid a circular import
  const auth = (req, res, next) => {
    const hd = req.headers.authorization || '';
    const user = verifyToken(hd.startsWith('Bearer ') ? hd.slice(7) : '');
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    req.user = user; next();
  };
  const r = express.Router();

  r.get('/notifications', auth, h(async (req, res) => {
    const [rows, unread] = await Promise.all([
      supabase.from('notifications').select(COLS).eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(KEEP),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('read_at', null)
    ]);
    res.json({ unread: unread.count || 0, items: (must(rows) || []).map(shape) });
  }));

  r.post('/notifications/read-all', auth, h(async (req, res) => {
    must(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', req.user.id).is('read_at', null));
    res.json({ ok: true });
  }));

  r.post('/notifications/:id/read', auth, h(async (req, res) => {
    const upd = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', String(req.params.id).slice(0, 40)).eq('user_id', req.user.id).is('read_at', null).select('id');
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data || !upd.data.length) {
      const own = await supabase.from('notifications').select('id').eq('id', String(req.params.id).slice(0, 40)).eq('user_id', req.user.id).maybeSingle();
      if (!own.data) return res.status(404).json({ error: 'Notification not found.' });
    }
    res.json({ ok: true });
  }));

  return r;
}

module.exports = { push, start, setIo, sweepReminders, buildNotifyRouter };
