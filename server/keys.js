// PASTE AS: server/keys.js  (new file)
// Day 7: stores each person's passphrase-protected chat key. The server only ever holds the encrypted blob.
const express = require('express');
const { supabase } = require('./supabase');
const activity = require('./activity');
const { verifyToken } = require('./routes');
const { audit } = require('./security');

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const field = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && B64.test(v);

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user; next();
}
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Does this person have a backup? If yes, returns it (it is useless without their passphrase).
router.get('/keys/backup', auth, h(async (req, res) => {
  const r = await supabase.from('key_backups').select('public_key, salt, iv, ciphertext, iterations').eq('user_id', req.user.id).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return res.json({ backup: null });
  audit('KEY_BACKUP_FETCH', { req, actorId: req.user.id, role: req.user.role });
  res.json({ backup: { publicKey: r.data.public_key, salt: r.data.salt, iv: r.data.iv, ciphertext: r.data.ciphertext, iterations: r.data.iterations } });
}));

// Save (or replace) the backup.
router.put('/keys/backup', auth, express.json({ limit: '20kb' }), h(async (req, res) => {
  const b = req.body || {};
  const it = Number(b.iterations);
  if (!field(b.publicKey, 200) || !field(b.salt, 64) || !field(b.iv, 32) || !field(b.ciphertext, 4000) || !Number.isInteger(it) || it < 100000 || it > 2000000) {
    return res.status(400).json({ error: 'That key backup is not valid.' });
  }
  const r = await supabase.from('key_backups').upsert({
    user_id: req.user.id, public_key: b.publicKey, salt: b.salt, iv: b.iv, ciphertext: b.ciphertext, iterations: it, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (r.error) throw new Error(r.error.message);
  audit('KEY_BACKUP_SAVE', { req, actorId: req.user.id, role: req.user.role });
  activity.log('Chat', `${req.user.name} saved a passphrase-protected chat key backup. The server holds only the scrambled copy`, 'chat');
  res.json({ ok: true });
}));

// "I forgot my passphrase": removes the backup so a new key can be made. Old chats stay locked.
router.delete('/keys/backup', auth, h(async (req, res) => {
  const r = await supabase.from('key_backups').delete().eq('user_id', req.user.id);
  if (r.error) throw new Error(r.error.message);
  audit('KEY_BACKUP_RESET', { req, actorId: req.user.id, role: req.user.role });
  activity.log('Chat', `${req.user.name} reset their chat key backup. Messages sent with the old key stay unreadable`, 'chat');
  res.json({ ok: true });
}));

module.exports = { router };
