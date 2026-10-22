// PASTE AS: server/attachments.js  Day 10: shares the allowed file types and the file check with records.js. Day 9: new-attachment alert. (replaces the old file)  Day 3: attachment records are stored in Supabase; the files stay on this laptop.
// Medical file attachments: patients upload X-rays, photos, reports. The doctor in the same appointment previews and downloads them.
// No extra npm package is needed: the browser sends the raw file as the request body.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { uid } = db;
const activity = require('./activity');
const notify = require('./notify');
const { verifyToken, participant } = require('./routes');

const DIR = path.join(__dirname, '..', 'storage', 'attachments');
fs.mkdirSync(DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 12;               // per appointment

// The attachments table is created by supabase/01_schema.sql (Day 2). Files themselves stay on this laptop in storage/attachments.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Allowed types. The safe content type is chosen by us from the extension, never taken from the browser.
const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// Check the first bytes so a renamed file (for example a .exe called x.jpg) is rejected.
function looksRight(ext, b) {
  const s = (a) => a.every((v, i) => b[i] === v);
  if (ext === 'jpg' || ext === 'jpeg') return s([0xff, 0xd8, 0xff]);
  if (ext === 'png') return s([0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'gif') return s([0x47, 0x49, 0x46, 0x38]);
  if (ext === 'webp') return s([0x52, 0x49, 0x46, 0x46]) && b.slice(8, 12).toString() === 'WEBP';
  if (ext === 'pdf') return b.slice(0, 5).toString() === '%PDF-';
  if (ext === 'docx') return s([0x50, 0x4b, 0x03, 0x04]);
  if (ext === 'doc') return s([0xd0, 0xcf, 0x11, 0xe0]);
  if (ext === 'txt') return !b.slice(0, 2000).includes(0);
  return false;
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user;
  next();
}

const meta = (r) => ({ id: r.id, name: r.filename, mime: r.mime, size: r.size, uploaderId: r.uploader_id, createdAt: r.created_at });

function buildAttachmentRouter(io) {
  const r = express.Router();

  r.get('/appointments/:id/attachments', auth, h(async (req, res) => {
    if (!(await participant(req.params.id, req.user.id))) return res.status(404).json({ error: 'Appointment not found.' });
    const rows = await db.listAttachments(req.params.id);
    res.json(rows.map(meta));
  }));

  // The browser sends the raw file. Name goes in the X-File-Name header.
  r.post('/appointments/:id/attachments', auth, express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h(async (req, res) => {
    if (req.user.role !== 'patient') return res.status(403).json({ error: 'Only the patient can upload files.' });
    const a = await participant(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Appointment not found.' });
    if (a.payment_status === 'paid') return res.status(409).json({ error: 'This consultation is finished. Uploads are closed.' });

    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'No file received.' });
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'File is too large. The limit is 10 MB.' });

    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
    name = path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 90) || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!TYPES[ext]) return res.status(400).json({ error: 'This file type is not allowed. Use JPG, PNG, WEBP, GIF, PDF, TXT, DOC or DOCX.' });
    if (!looksRight(ext, body)) return res.status(400).json({ error: 'The file content does not match its type. Please choose the original file.' });

    const count = await db.countAttachments(a.id);
    if (count >= MAX_FILES) return res.status(409).json({ error: `You can add up to ${MAX_FILES} files per consultation.` });

    const id = uid('ATT');
    const file = path.join(DIR, id + '.' + ext);
    fs.writeFileSync(file, body);
    let row;
    try {
      row = await db.insertAttachment({ id, appointment_id: a.id, uploader_id: req.user.id, filename: name, mime: TYPES[ext], size: body.length, file_path: file });
    } catch (e) { try { fs.unlinkSync(file); } catch {} throw e; }
    io.to('appt:' + a.id).emit('attachment:new', meta(row));
    io.to('user:' + a.doctor_id).emit('attachment:new', meta(row));
    notify.push(a.doctor_id, { kind: 'new_attachment', title: 'New file from your patient', body: `${req.user.name} shared "${name}"`, link: `/consult.html?a=${a.id}`, dedupeKey: 'att:' + id });
    activity.log('Attachments', `${req.user.name} uploaded "${name}" (${Math.round(body.length / 1024)} KB). Doctor notified instantly`, 'document');
    res.json(meta(row));
  }));

  // Preview (inline) or download (?download=1). Only the two people in the appointment can open it.
  r.get('/attachments/:attId/file', auth, h(async (req, res) => {
    const row = await db.getAttachment(req.params.attId);
    if (!row || !(await participant(row.appointment_id, req.user.id))) return res.status(404).json({ error: 'File not found.' });
    if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: 'File is missing on the server.' });
    const dl = req.query.download === '1';
    res.setHeader('Content-Type', row.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    if (dl) activity.log('Attachments', `${req.user.name} downloaded "${row.filename}"`, 'document');
    fs.createReadStream(row.file_path).pipe(res);
  }));

  r.delete('/attachments/:attId', auth, h(async (req, res) => {
    const row = await db.getAttachment(req.params.attId);
    if (!row || row.uploader_id !== req.user.id) return res.status(404).json({ error: 'File not found.' });
    const a = await db.getAppointment(row.appointment_id);
    if (a.payment_status === 'paid') return res.status(409).json({ error: 'This consultation is finished.' });
    await db.deleteAttachment(row.id);
    try { fs.unlinkSync(row.file_path); } catch {}
    io.to('appt:' + a.id).emit('attachment:removed', { id: row.id });
    activity.log('Attachments', `${req.user.name} removed "${row.filename}"`, 'document');
    res.json({ removed: true });
  }));

  // Friendly message when a file is over the size limit
  r.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'File is too large. The limit is 10 MB.' });
    next(err);
  });

  return r;
}

module.exports = { buildAttachmentRouter, TYPES, looksRight };
