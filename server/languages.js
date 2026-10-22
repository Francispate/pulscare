// PASTE AS: server/languages.js  (replaces the old file)  Day 3: stored in Supabase.
// Languages people speak (patients and doctors). Used to show patients the doctors who speak their way.
// The "languages" column and the 6 doctors' starting languages were created by schema.sql and the seed script on Day 2.
const express = require('express');
const db = require('./db');
const activity = require('./activity');
const { verifyToken } = require('./routes');

const ALIASES = { english: 'English', hindi: 'Hindi', kannada: 'Kannada', 'हिन्दी': 'Hindi', 'हिंदी': 'Hindi', 'ಕನ್ನಡ': 'Kannada' };

// Clean what the user typed: letters only, no duplicates, nicely capitalised, at most 8 languages.
function clean(list) {
  const out = [], seen = new Set();
  for (let raw of Array.isArray(list) ? list : []) {
    raw = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!raw || raw.length > 30) continue;
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(raw)) continue;
    const name = ALIASES[raw.toLowerCase()] || ALIASES[raw] || raw.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase()); out.push(name);
  }
  return out.slice(0, 8);
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user; next();
}

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

router.get('/me/languages', auth, h(async (req, res) => {
  res.json({ languages: await db.getLanguages(req.user.id) });
}));

router.put('/me/languages', auth, express.json({ limit: '5kb' }), h(async (req, res) => {
  const langs = clean((req.body || {}).languages);
  if (!langs.length) return res.status(400).json({ error: 'Choose at least one language, or type your own.' });
  await db.setLanguages(req.user.id, langs.join(','));
  activity.log('Profile', `${req.user.name} set languages: ${langs.join(' + ')}. Doctors are matched on this`, 'auth');
  res.json({ languages: langs });
}));

module.exports = { router, clean };
