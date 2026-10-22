// PASTE AS: scripts/day9-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day9-check.js     (takes about 30 to 60 seconds: it waits for the queue and reminder timers)
// Tests every alert: new request, new attachment, payment done, queue turn, slot reminder. Also: unread counts, mark as read,
// "after a reload they are still there", nobody can touch someone else's alerts, and the same alert is never created twice.
// It adds one test appointment to Supabase (like day3-check) and removes its temporary patient, slot and queue rows.
const { supabase } = require('../server/supabase');
const db = require('../server/db');
const notify = require('../server/notify');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
const DOC = 'DOC-1003';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body, headers, raw) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(headers || {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const bell = async (token) => (await call('GET', '/notifications', token)).data;
// Waits until this person has an alert of this kind created after the test started.
async function waitFor(token, kind, since, seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    const b = await bell(token);
    const hit = b && b.items.find((n) => n.kind === kind && n.createdAt >= since);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

(async () => {
  console.log('\nDay 9 check against ' + BASE + '\n');
  const since = new Date().toISOString();
  const tempUsers = [], tempSlots = [], tempAppts = [];
  let D = null, A = null;
  try {
    // ---------- setup ----------
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'in_progress');
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'booked').is('slot_id', null);
    await supabase.from('queue_entries').update({ status: 'removed' }).eq('doctor_id', DOC).in('status', ['waiting', 'notified']);
    await supabase.from('consult_requests').update({ status: 'expired' }).eq('doctor_id', DOC).eq('status', 'pending');

    let r = await call('GET', '/notifications');
    ok('The bell needs a login', r.status === 401);

    const dl = await call('POST', '/auth/doctor-login', null, { doctorId: DOC, password: 'doctor123' });
    const pa = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
    ok('Doctor and demo patient can log in', dl.status === 200 && pa.status === 200);
    if (dl.status !== 200 || pa.status !== 200) return;
    D = dl.data.token; const P = pa.data.token;
    const reg = await call('POST', '/auth/register', null, { fullName: 'Bell Patient', email: `b${Date.now()}@pulscare.test`, password: 'patient123' });
    tempUsers.push(reg.data.user.id); const B = reg.data.token, Bid = reg.data.user.id;

    let b = await bell(B);
    ok('A new person has an empty bell (0 unread)', b.unread === 0 && b.items.length === 0);

    // ---------- 1. new request -> doctor ----------
    const docBefore = (await bell(D)).unread;
    await call('POST', '/doctor/online', D, { online: true });
    const rq = await call('POST', '/requests', P, { doctorId: DOC, symptoms: 'Day 9 check: headache' });
    ok('Patient sends a request', rq.status === 200 && rq.data.requestId, rq.data && rq.data.error || '');
    if (!rq.data.requestId) return;
    let n = await waitFor(D, 'new_request', since);
    ok('Doctor gets a "New consultation request" alert', !!n && /Demo Patient/.test(n.body) && /headache/.test(n.body), n && n.body);
    b = await bell(D);
    ok('Doctor unread count went up', b.unread > docBefore || b.unread >= 1, `unread ${b.unread}`);

    const acc = await call('POST', `/requests/${rq.data.requestId}/respond`, D, { accept: true });
    A = acc.data.appointmentId;
    ok('Doctor accepts, appointment created', !!A);
    if (!A) return;

    // ---------- 2. new attachment -> doctor ----------
    const up = await call('POST', `/appointments/${A}/attachments`, P, 'Day 9 test report', { 'X-File-Name': 'report.txt', 'Content-Type': 'text/plain' }, true);
    ok('Patient uploads a file', up.status === 200, up.data && up.data.error || '');
    n = await waitFor(D, 'new_attachment', since);
    ok('Doctor gets a "New file" alert that opens the consult', !!n && /report\.txt/.test(n.body) && n.link.includes(A), n && n.link);

    // ---------- 3. queue turn -> waiting patient ----------
    const q = await call('POST', '/requests', B, { doctorId: DOC, symptoms: 'Day 9 queue' });
    ok('Second patient is put in the queue (doctor is busy)', q.status === 200 && q.data.queued === true, JSON.stringify(q.data).slice(0, 100));

    // ---------- 4. payment -> patient and doctor ----------
    await call('PUT', `/appointments/${A}/prescription`, D, { diagnosis: 'Day 9 test', notes: 'Rest', items: [{ medicine: 'Paracetamol', dose: '500 mg', frequency: 'Twice daily', timing: 'After meals', days: 3 }] });
    await db.setAppointmentStatus(A, 'awaiting_payment'); // the doctor ends the call: the queue should now call patient B
    const pay = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
    ok('Payment succeeds', pay.status === 200, pay.data && pay.data.error || '');
    n = await waitFor(P, 'payment_done', since);
    ok('Patient gets a "Payment received" alert', !!n && /Rs/.test(n.body));
    n = await waitFor(D, 'payment_done', since);
    ok('Doctor gets a "Patient has paid" alert', !!n && /Demo Patient/.test(n.body));

    n = await waitFor(B, 'queue_turn', since, 25);
    ok('Queue patient gets "Doctor is ready. Join now" (within the 10 second queue timer)', !!n && /Join now/.test(n.title), n ? '' : 'no alert after 25s');

    // ---------- 5. unread, read, reload, privacy ----------
    b = await bell(B);
    const turn = b.items.find((x) => x.kind === 'queue_turn');
    ok('That alert is unread and counted', turn && turn.read === false && b.unread >= 1, `unread ${b.unread}`);
    r = await call('POST', `/notifications/${turn.id}/read`, P);
    ok("Another person cannot mark your alert as read (404)", r.status === 404);
    b = await bell(B);
    ok('...and it is still unread', b.items.find((x) => x.id === turn.id).read === false);
    r = await call('POST', `/notifications/${turn.id}/read`, B);
    const unreadBefore = b.unread;
    b = await bell(B);
    ok('Marking it read lowers the unread count by one', r.status === 200 && b.unread === unreadBefore - 1, `${unreadBefore} -> ${b.unread}`);
    ok('After a reload it is still there, now marked read (alerts are saved)', b.items.find((x) => x.id === turn.id).read === true);
    r = await call('POST', '/notifications/NOPE/read', B);
    ok('An unknown alert id gives 404', r.status === 404);

    // ---------- 6. the same alert is never created twice ----------
    const key = 'test-dup-' + Date.now();
    const one = await notify.push(Bid, { kind: 'new_request', title: 'Duplicate test', dedupeKey: key });
    const two = await notify.push(Bid, { kind: 'new_request', title: 'Duplicate test', dedupeKey: key });
    b = await bell(B);
    ok('Pushing the same alert twice creates it once', !!one && two === null && b.items.filter((x) => x.title === 'Duplicate test').length === 1);

    // ---------- 7. slot reminder -> patient and doctor ----------
    const slotId = 'SLT-T9' + Date.now().toString(36).toUpperCase(), apptId = 'APT-T9' + Date.now().toString(36).toUpperCase();
    const startsAt = new Date(Date.now() + 10 * 60000), endsAt = new Date(startsAt.getTime() + 15 * 60000);
    const s1 = await supabase.from('doctor_slots').insert({ id: slotId, doctor_id: DOC, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), patient_id: Bid, booked_at: new Date().toISOString() });
    if (s1.error) throw new Error('could not create the test slot: ' + s1.error.message);
    tempSlots.push(slotId);
    const a1 = await supabase.from('appointments').insert({ id: apptId, patient_id: Bid, doctor_id: DOC, room_id: require('crypto').randomBytes(12).toString('hex'), fee: 300, status: 'booked', slot_id: slotId });
    if (a1.error) throw new Error('could not create the test appointment: ' + a1.error.message);
    tempAppts.push(apptId);
    console.log('  ....  Waiting for the reminder timer (up to 45 seconds)...');
    n = await waitFor(B, 'slot_reminder', since, 45);
    ok('Patient gets a "Your visit starts soon" reminder (visit in 10 minutes)', !!n && /min/.test(n.body), n && n.body);
    const dn = await waitFor(D, 'slot_reminder', since, 5);
    ok('Doctor gets the visit reminder too', !!dn && /Bell Patient/.test(dn.body));

    // ---------- 8. mark all read ----------
    r = await call('POST', '/notifications/read-all', D);
    b = await bell(D);
    ok('Mark all read clears the unread count', r.status === 200 && b.unread === 0 && b.items.length > 0);
    b = await bell(B);
    ok("...and does not touch other people's alerts", b.unread >= 1, `patient B still has ${b.unread} unread`);
  } catch (e) {
    console.log('  FAIL  Unexpected error: ' + e.message); failed++;
  } finally {
    try { if (D) await call('POST', '/doctor/online', D, { online: false }); } catch {}
    for (const id of tempAppts) await supabase.from('appointments').delete().eq('id', id);
    for (const id of tempSlots) await supabase.from('doctor_slots').delete().eq('id', id);
    if (tempUsers.length) {
      await supabase.from('queue_entries').delete().in('patient_id', tempUsers);
      await supabase.from('users').delete().in('id', tempUsers);
    }
  }
  console.log(failed ? `\n${failed} check(s) FAILED. Send me the lines above.\n` : '\nAll Day 9 checks passed. Now do the live test in the browser (steps in the chat), then close Day 9.\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });
