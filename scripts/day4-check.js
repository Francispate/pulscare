// PASTE AS: scripts/day4-check.js  (new file)
// Run with the server RUNNING (with your new JWT_SECRET) in another window:  node scripts/day4-check.js
// 1) starts a second copy of the server with the DEFAULT secret and checks that it refuses to run
// 2) tries 6 wrong passwords and checks the 6th is blocked, while a different account still logs in
// 3) does one full demo (login, request, accept, pay, download) and checks each step is in audit_log
const { spawn } = require('child_process');
const path = require('path');
const db = require('../server/db');
const { supabase } = require('../server/supabase');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body, raw) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function startWithDefaultSecret() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, JWT_SECRET: 'change-me-for-the-demo', PORT: '3999' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => { child.kill(); resolve({ exited: false, out }); }, 8000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ exited: true, code, out }); });
  });
}

(async () => {
  console.log('\nDay 4 check against ' + BASE + '\n');
  const since = new Date(Date.now() - 2000).toISOString();

  // 1. Secret
  const r = await startWithDefaultSecret();
  ok('Server refuses to start with the default JWT secret', r.exited && r.code !== 0 && /REFUSING TO START/.test(r.out));

  // 2. Rate limit
  const who = 'nobody' + Date.now() + '@pulscare.test';
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call('POST', '/auth/login', null, { email: who, password: 'wrong-' + i })).status);
  ok('5 wrong passwords answer 401, the 6th is blocked with 429', codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429, codes.join(','));
  const good = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
  ok('A different account can still log in', good.status === 200 && good.data.token);
  const dr = await call('POST', '/auth/doctor-login', null, { doctorId: 'DOC-1003', password: 'doctor123' });
  ok('Doctor login still works', dr.status === 200 && dr.data.token);
  if (!good.data || !good.data.token || !dr.data || !dr.data.token) return finish();
  const P = good.data.token, D = dr.data.token;

  // 3. Audit log: full demo
  await call('POST', '/doctor/online', D, { online: true });
  const rq = await call('POST', '/requests', P, { doctorId: 'DOC-1003', symptoms: 'Day 4 check' });
  const ac = rq.data && rq.data.requestId && await call('POST', `/requests/${rq.data.requestId}/respond`, D, { accept: true });
  if (!ac || !ac.data.appointmentId) { ok('Demo appointment created', false, JSON.stringify(rq.data)); return finish(); }
  const A = ac.data.appointmentId;
  await call('PUT', `/appointments/${A}/prescription`, D, { diagnosis: 'Check', items: [{ medicine: 'Paracetamol', dose: '500 mg', frequency: 'Twice a day', timing: 'After food', days: 2 }] });
  await db.setAppointmentStatus(A, 'awaiting_payment');
  const pay = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
  ok('Payment works', pay.status === 200, pay.data && (pay.data.invoiceNo || pay.data.error));
  const dl = await call('GET', `/documents/${A}/prescription`, P, null, true);
  ok('Prescription downloads', dl.status === 200);
  await call('POST', '/doctor/online', D, { online: false });

  await sleep(1500); // audit writes are sent in the background
  const q = await supabase.from('audit_log').select('action, actor_id, ip, detail').gte('at', since).order('id');
  ok('audit_log is readable', !q.error, q.error && q.error.message);
  const rows = q.data || [];
  const has = (a, f = () => true) => rows.some((x) => x.action === a && f(x));
  ok('LOGIN_FAIL recorded', has('LOGIN_FAIL', (x) => x.detail.who === who));
  ok('LOGIN_BLOCKED recorded', has('LOGIN_BLOCKED'));
  ok('LOGIN_OK recorded (patient and doctor)', has('LOGIN_OK', (x) => x.actor_id === 'PT-DEMO01') && has('LOGIN_OK', (x) => x.actor_id === 'DOC-1003'));
  ok('PAYMENT_OK recorded with the invoice number', has('PAYMENT_OK', (x) => x.detail.appointmentId === A && x.detail.invoiceNo));
  ok('DOCUMENT_DOWNLOAD recorded', has('DOCUMENT_DOWNLOAD', (x) => x.detail.appointmentId === A));
  ok('IP address is stored', rows.some((x) => x.ip));
  ok('Passwords are never written to the log', !JSON.stringify(rows).match(/wrong-\d|patient123|doctor123/));
  finish();
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });

function finish() {
  console.log(failed ? `\n${failed} check(s) FAILED. Do not close Day 4 yet.\n` : '\nDay 4 check passed.\n');
  process.exit(failed ? 1 : 0);
}
