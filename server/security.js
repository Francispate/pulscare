// PASTE AS: server/security.js  (new file)
// Day 4: JWT secret check, login rate limiting, and the audit log.
require('dotenv').config();
const { supabase } = require('./supabase');

// ---------- 1. JWT secret: the server refuses to start with a weak or default secret ----------
const BAD_SECRETS = ['change-me-for-the-demo', 'pulscare-prototype-secret', 'secret', 'changeme', 'password'];
function loadJwtSecret() {
  const s = String(process.env.JWT_SECRET || '').trim();
  const problem =
    !s ? 'JWT_SECRET is missing from .env.' :
    BAD_SECRETS.includes(s.toLowerCase()) || /^change-?me/i.test(s) ? 'JWT_SECRET is still a default/placeholder value.' :
    s.length < 32 ? 'JWT_SECRET is too short (use at least 32 characters).' : null;
  if (problem) {
    console.error('\n==============================================');
    console.error(' REFUSING TO START: ' + problem);
    console.error(' Generate a strong one with this command:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    console.error(' Then put it in .env as:  JWT_SECRET=<the long text>  and start again.');
    console.error(' (Never share it in chat, screenshots or git.)');
    console.error('==============================================\n');
    process.exit(1);
  }
  return s;
}
const JWT_SECRET = loadJwtSecret();

// ---------- 2. Rate limiting (in memory; resets when the server restarts) ----------
const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');

// Counts FAILED attempts. After "max" failures inside the window, further attempts are blocked until the oldest one expires.
function failureGuard({ windowMs = 60000, max = 5 } = {}) {
  const hits = new Map(); // key -> [timestamps]
  const fresh = (key, now) => { const a = (hits.get(key) || []).filter((t) => now - t < windowMs); a.length ? hits.set(key, a) : hits.delete(key); return a; };
  const timer = setInterval(() => { const now = Date.now(); for (const k of [...hits.keys()]) fresh(k, now); }, 60000);
  timer.unref();
  return {
    check(key) { const now = Date.now(), a = fresh(key, now); return a.length >= max ? { blocked: true, retryAfter: Math.max(1, Math.ceil((windowMs - (now - a[0])) / 1000)) } : { blocked: false }; },
    fail(key) { const now = Date.now(), a = fresh(key, now); a.push(now); hits.set(key, a); },
    clear(key) { hits.delete(key); }
  };
}
// 5 wrong passwords per minute for one account from one device; 20 per minute from one device across all accounts.
const loginGuard = failureGuard({ windowMs: 60000, max: 5 });
const ipGuard = failureGuard({ windowMs: 60000, max: 20 });

// Counts every call (for sign-ups): at most "max" per window per key.
function hitLimiter({ windowMs = 3600000, max = 20 } = {}) {
  const g = failureGuard({ windowMs, max });
  return { take(key) { const c = g.check(key); if (!c.blocked) g.fail(key); return c; } };
}
const signupLimiter = hitLimiter({ windowMs: 3600000, max: 20 });

// ---------- 3. Audit log ----------
// Never slows or breaks the request: a failed write is printed in the server window and nothing else happens.
function audit(action, { req, actorId = null, role = null, detail = {} } = {}) {
  const row = { action, actor_id: actorId, actor_role: role, ip: req ? clientIp(req) : null, detail };
  Promise.resolve(supabase.from('audit_log').insert(row))
    .then((r) => { if (r.error) console.error('Audit log write failed:', r.error.message); })
    .catch((e) => console.error('Audit log write failed:', e.message));
}

module.exports = { JWT_SECRET, clientIp, loginGuard, ipGuard, signupLimiter, audit };
