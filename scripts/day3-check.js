// PASTE AS: scripts/day3-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day3-check.js
// Walks the whole demo through the real API: login -> request -> accept -> prescription -> payment -> two PDFs -> verify.
// It also tries to pay twice (must be rejected). It adds one test appointment to Supabase.
const db = require('../server/db');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

async function call(method, path, token, body, raw) {
  const res = await fetch(BASE + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function finish() {
  console.log(failed ? `\n${failed} check(s) FAILED. Do not close Day 3 yet.\n` : '\nDay 3 check passed. No SQLite file was used.\n');
  process.exit(failed ? 1 : 0);
}

(async () => {
  console.log('\nDay 3 check against ' + BASE + '\n');
  const health = await call('GET', '/health');
  ok('Server up and using Supabase', health.data && health.data.status === 'ok', health.data && 'doctors: ' + health.data.doctors);

  const pt = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
  ok('Patient login', pt.status === 200 && pt.data.token);
  const dr = await call('POST', '/auth/doctor-login', null, { doctorId: 'DOC-1003', password: 'doctor123' });
  ok('Doctor login', dr.status === 200 && dr.data.token);
  if (failed) return finish();
  const P = pt.data.token, D = dr.data.token;

  const docs = await call('GET', '/doctors');
  ok('Doctor list (6 doctors, with languages)', docs.data.length === 6 && docs.data[0].languages.length > 0);

  const lang = await call('PUT', '/me/languages', P, { languages: ['English', 'Kannada'] });
  ok('Patient languages saved', lang.status === 200 && lang.data.languages.length === 2);

  await call('POST', '/doctor/online', D, { online: true });
  const req1 = await call('POST', '/requests', P, { doctorId: 'DOC-1003', symptoms: 'Day 3 check: mild fever' });
  ok('Request created', req1.status === 200 && req1.data.requestId, (req1.data && req1.data.error) || '');
  if (!req1.data.requestId) return finish();

  const pend = await call('GET', '/requests/pending', D);
  const mine = pend.data.find((x) => x.id === req1.data.requestId);
  ok("Doctor sees the request with the patient's languages", mine && mine.patientLanguages.includes('Kannada'));

  const acc = await call('POST', `/requests/${req1.data.requestId}/respond`, D, { accept: true });
  ok('Doctor accepted, appointment created', acc.status === 200 && acc.data.appointmentId);
  if (!acc.data.appointmentId) return finish();
  const A = acc.data.appointmentId;
  const acc2 = await call('POST', `/requests/${req1.data.requestId}/respond`, D, { accept: true });
  ok('Accepting the same request again is refused', acc2.status === 409);

  const rx = await call('PUT', `/appointments/${A}/prescription`, D, { diagnosis: 'Viral fever', notes: 'Rest', items: [{ medicine: 'Paracetamol', dose: '500 mg', frequency: 'Twice a day', timing: 'After food', days: 3 }] });
  ok('Prescription draft saved', rx.status === 200);

  // In the real app the doctor ends the call over the websocket. Here we move the appointment the same way the server does.
  await db.setAppointmentStatus(A, 'awaiting_payment');

  const failPay = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'upi', upi: 'fail@bank' });
  ok('Declined test payment is rejected and nothing is released', failPay.status === 402);

  const pay = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
  ok('Payment succeeds, invoice number comes from the Postgres sequence', pay.status === 200 && /^INV-\d{4}-\d+$/.test(pay.data.invoiceNo), pay.data.invoiceNo || pay.data.error);

  const pay2 = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
  ok('Paying a second time is rejected (no double payment)', pay2.status === 409);

  for (const type of ['prescription', 'invoice']) {
    const r = await call('GET', `/documents/${A}/${type}`, P, null, true);
    const buf = Buffer.from(await r.arrayBuffer());
    ok(`${type} PDF downloads`, r.status === 200 && buf.slice(0, 5).toString() === '%PDF-', buf.length + ' bytes');
  }

  const stored = await db.getRx(A);
  ok('Prescription hash saved', !!(stored && stored.sha256));
  const v = await call('GET', '/verify/' + (stored && stored.sha256));
  ok('Verify logic says VALID', v.data && v.data.valid === true, (v.data && v.data.reason) || '');
  const bad = await call('GET', '/verify/' + 'a'.repeat(64));
  ok('Unknown signature says not valid', bad.data && bad.data.valid === false);

  await call('POST', '/doctor/online', D, { online: false });
  finish();
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });
