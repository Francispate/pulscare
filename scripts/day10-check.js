// PASTE AS: scripts/day10-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day10-check.js     (takes about 20 seconds)
// Tests the medical record: a patient adds allergies, conditions and reports; a doctor can open the record ONLY during or after an
// accepted appointment with that patient (a booked slot counts once its room opens); drafts stay hidden until payment; files are private;
// every doctor view is logged and the patient is told.
// It creates two temporary patients and one test consultation, and tries to remove all of it at the end.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabase } = require('../server/supabase');
const db = require('../server/db');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
const DOC = 'DOC-1003', OTHER_DOC = 'DOC-1001';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function upload(token, bytes, name, extra = {}) {
  const res = await fetch(BASE + '/api/records/reports', { method: 'POST', body: bytes, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...extra } });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function getFile(url, token) {
  const res = await fetch(BASE + url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

(async () => {
  console.log('\nDay 10 check against ' + BASE + '\n');
  const startedAt = new Date().toISOString();
  const tempUsers = [], apptIds = [], slotIds = [];
  let D = null, O = null;
  try {
    // ---------- setup ----------
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'in_progress');
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'booked').is('slot_id', null);
    await supabase.from('queue_entries').update({ status: 'removed' }).eq('doctor_id', DOC).in('status', ['waiting', 'notified']);
    await supabase.from('consult_requests').update({ status: 'expired' }).eq('doctor_id', DOC).eq('status', 'pending');

    const dl = await call('POST', '/auth/doctor-login', null, { doctorId: DOC, password: 'doctor123' });
    const od = await call('POST', '/auth/doctor-login', null, { doctorId: OTHER_DOC, password: 'doctor123' });
    ok('Both doctors can log in', dl.status === 200 && od.status === 200);
    if (dl.status !== 200 || od.status !== 200) return;
    D = dl.data.token; const D2 = od.data.token;
    const mk = async (label) => {
      const r = await call('POST', '/auth/register', null, { fullName: 'Record ' + label, email: `r${label.toLowerCase()}${Date.now()}@pulscare.test`, password: 'patient123' });
      if (r.status !== 200) throw new Error('could not create test patient ' + label);
      tempUsers.push(r.data.user.id); return { token: r.data.token, id: r.data.user.id };
    };
    const owner = await mk('Owner'), stranger = await mk('Stranger');
    O = owner.token;

    // ---------- 1. empty record, who can call what ----------
    let r = await call('GET', '/records/me');
    ok('The record needs a login', r.status === 401);
    r = await call('GET', '/records/me', D);
    ok('A doctor cannot use the patient\'s own-record route', r.status === 403);
    r = await call('GET', '/records/me', O);
    ok('A new patient has an empty record', r.status === 200 && !r.data.profile.allergies.length && !r.data.profile.conditions.length && !r.data.reports.length && !r.data.timeline.length);

    // ---------- 2. allergies and conditions ----------
    r = await call('POST', '/records/history', O, { kind: 'allergy', name: 'Penicillin', severity: 'severe', note: 'rash' });
    ok('Patient adds an allergy', r.status === 200 && r.data.id);
    const allergyId = r.data.id;
    r = await call('POST', '/records/history', O, { kind: 'allergy', name: '  penicillin ' });
    ok('The same allergy cannot be added twice (capitals do not matter)', r.status === 409, r.data && r.data.error);
    r = await call('POST', '/records/history', O, { kind: 'food', name: 'Peanuts' });
    ok('A wrong kind is refused', r.status === 400);
    r = await call('POST', '/records/history', O, { kind: 'condition', name: 'a' });
    ok('A one-letter name is refused', r.status === 400);
    r = await call('POST', '/records/history', O, { kind: 'condition', name: 'Asthma', severity: 'severe' });
    const condId = r.data && r.data.id;
    ok('Patient adds a condition (severity is only for allergies)', r.status === 200 && r.data.severity === null);
    r = await call('DELETE', '/records/history/' + allergyId, stranger.token);
    ok("Another patient cannot remove your allergy (404)", r.status === 404);
    r = await call('DELETE', '/records/history/' + condId, O);
    ok('Patient removes their own condition', r.status === 200);
    r = await call('DELETE', '/records/history/' + condId, O);
    ok('Removing it again gives 404', r.status === 404);
    r = await call('POST', '/records/history', O, { kind: 'condition', name: 'Hypertension', note: 'since 2020' });
    ok('Patient adds another condition', r.status === 200);

    // ---------- 3. reports ----------
    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n% Day 10 test report\n'), crypto.randomBytes(200)]);
    r = await upload(O, pdfBytes, 'blood-test.pdf', { 'X-Report-Title': encodeURIComponent('Blood test'), 'X-Report-Date': '2026-09-01' });
    ok('Patient uploads a report', r.status === 200 && r.data.id, r.data && r.data.error || '');
    const repId = r.data && r.data.id;
    r = await upload(O, Buffer.from('MZ not really a pdf'), 'fake.pdf');
    ok('A file whose content does not match its type is refused', r.status === 400);
    r = await upload(O, Buffer.from('MZ'), 'virus.exe');
    ok('A file type that is not allowed is refused', r.status === 400);
    r = await upload(O, pdfBytes, 'x.pdf', { 'X-Report-Date': '2026-13-45' });
    ok('An impossible report date is refused', r.status === 400);
    r = await upload(O, pdfBytes, 'x.pdf', { 'X-Report-Date': '2999-01-01' });
    ok('A report date in the future is refused', r.status === 400);
    let f = await getFile(`/api/records/reports/${repId}/file`, O);
    ok('The patient can open their report (same bytes)', f.status === 200 && f.buf.equals(pdfBytes));
    f = await getFile(`/api/records/reports/${repId}/file`, stranger.token);
    ok("Another patient cannot open it (404)", f.status === 404);
    f = await getFile(`/api/records/reports/${repId}/file`, D2);
    ok('A doctor with no appointment cannot open it (404)', f.status === 404);
    f = await getFile(`/api/records/reports/${repId}/file`, null);
    ok('Without logging in there is no access (401)', f.status === 401);

    // ---------- 4. doctors with NO appointment ----------
    r = await call('GET', '/records/patient/' + owner.id, D);
    ok('A doctor with no appointment cannot open the record (403)', r.status === 403, r.data && r.data.error);
    r = await call('GET', '/records/patient/' + owner.id, D2);
    ok('Another doctor with no appointment cannot either', r.status === 403);
    r = await call('GET', '/records/patient/' + owner.id, stranger.token);
    ok('A patient cannot use the doctor route', r.status === 403);
    r = await call('GET', '/records/patient/NOT-A-USER', D);
    ok('An unknown patient id gives the same 403 (nothing leaks)', r.status === 403);

    // ---------- 5. accepted appointment: the doctor can see it ----------
    await call('POST', '/doctor/online', D, { online: true });
    const rq = await call('POST', '/requests', O, { doctorId: DOC, symptoms: 'Day 10 check' });
    const acc = await call('POST', `/requests/${rq.data.requestId}/respond`, D, { accept: true });
    const A = acc.data && acc.data.appointmentId;
    ok('Patient requests, doctor accepts', !!A, rq.data && rq.data.error || '');
    if (!A) return;
    apptIds.push(A);
    r = await call('GET', '/records/patient/' + owner.id, D);
    ok('After accepting, the doctor can open the record', r.status === 200 && r.data.viewer === 'doctor');
    ok('The doctor sees the allergy with its severity', r.data.profile.allergies.some((x) => x.name === 'Penicillin' && x.severity === 'severe'));
    ok('The doctor sees the condition', r.data.profile.conditions.some((x) => x.name === 'Hypertension'));
    ok('The doctor sees the report', r.data.reports.some((x) => x.id === repId && x.title === 'Blood test'));
    f = await getFile(`/api/records/reports/${repId}/file`, D);
    ok('The doctor can open the report file', f.status === 200 && f.buf.equals(pdfBytes));
    r = await call('POST', '/records/history', D, { kind: 'allergy', name: 'Sneaky' });
    ok('A doctor cannot change the record (403)', r.status === 403);
    r = await call('GET', '/records/patient/' + owner.id, D2);
    ok('The other doctor still cannot open it', r.status === 403);

    // the patient is told
    let told = null;
    for (let i = 0; i < 10 && !told; i++) { const b = (await call('GET', '/notifications', O)).data; told = b && b.items.find((n) => n.kind === 'record_viewed' && n.createdAt >= startedAt); if (!told) await sleep(500); }
    ok('The patient got a "Your medical record was opened" alert', !!told, told && told.body);

    // ---------- 6. drafts stay hidden until payment ----------
    await call('PUT', `/appointments/${A}/prescription`, D, { diagnosis: 'Day 10 test', notes: 'Rest well', items: [{ medicine: 'Amoxicillin', dose: '250 mg', frequency: 'Thrice daily', timing: 'After meals', days: 5 }] });
    r = await call('GET', '/records/me', O);
    ok('A prescription draft is NOT in the record before payment', !r.data.timeline.some((t) => t.type === 'prescription' || t.type === 'consult'));
    r = await call('GET', '/records/patient/' + owner.id, D);
    ok('...and not visible to the doctor either (the doctor sees it in the room)', !r.data.timeline.some((t) => t.type === 'prescription'));
    await db.setAppointmentStatus(A, 'awaiting_payment');
    const pay = await call('POST', '/payments/pay', O, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
    ok('Payment succeeds', pay.status === 200, pay.data && pay.data.error || '');
    r = await call('GET', '/records/me', O);
    const types = r.data.timeline.map((t) => t.type);
    ok('After payment the timeline has the consultation and the prescription', types.includes('consult') && types.includes('prescription'));
    const rxItem = r.data.timeline.find((t) => t.type === 'prescription');
    ok('The prescription shows its medicines and the patient can open the PDF', rxItem && rxItem.medicines.some((m) => m.medicine === 'Amoxicillin') && rxItem.open && rxItem.open.url.includes(A));
    ok('The timeline also has the allergy, the condition and the report', ['allergy', 'condition', 'report'].every((x) => types.includes(x)));
    ok('The timeline is newest first', r.data.timeline.every((t, i, a) => i === 0 || String(a[i - 1].at) >= String(t.at)));
    r = await call('GET', '/records/patient/' + owner.id, D);
    ok('The consulting doctor can still open the record AFTER the consultation', r.status === 200 && r.data.timeline.some((t) => t.type === 'prescription' && t.open));

    // ---------- 7. booked slot: only once the room opens ----------
    const slotId = 'SLT-T10' + Date.now().toString(36).toUpperCase(), slotAppt = 'APT-T10' + Date.now().toString(36).toUpperCase();
    const starts = new Date(Date.now() + 3 * 3600000);
    const s1 = await supabase.from('doctor_slots').insert({ id: slotId, doctor_id: OTHER_DOC, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 15 * 60000).toISOString(), patient_id: owner.id, booked_at: new Date().toISOString() });
    if (s1.error) throw new Error('could not create the test slot: ' + s1.error.message);
    slotIds.push(slotId);
    const a1 = await supabase.from('appointments').insert({ id: slotAppt, patient_id: owner.id, doctor_id: OTHER_DOC, room_id: crypto.randomBytes(12).toString('hex'), fee: 300, status: 'booked', slot_id: slotId });
    if (a1.error) throw new Error('could not create the test booking: ' + a1.error.message);
    apptIds.push(slotAppt);
    r = await call('GET', '/records/patient/' + owner.id, D2);
    ok('A visit booked for 3 hours from now does NOT open the record yet (403)', r.status === 403);
    await supabase.from('doctor_slots').update({ starts_at: new Date(Date.now() + 5 * 60000).toISOString(), ends_at: new Date(Date.now() + 20 * 60000).toISOString() }).eq('id', slotId);
    r = await call('GET', '/records/patient/' + owner.id, D2);
    ok('Once the room opens (10 minutes before) the record opens', r.status === 200);
    const rx2 = r.status === 200 && r.data.timeline.find((t) => t.type === 'prescription');
    ok("Another doctor sees the earlier prescription's summary but cannot open its PDF", !!rx2 && rx2.open === null && rx2.medicines.length > 0);
    f = await getFile(`/api/documents/${A}/prescription`, D2);
    ok("...and the PDF route agrees (404)", f.status === 404);

    // ---------- 8. removing a report ----------
    r = await call('DELETE', '/records/reports/' + repId, stranger.token);
    ok("Another patient cannot remove your report (404)", r.status === 404);
    const onDisk = () => fs.readdirSync(path.join(__dirname, '..', 'storage', 'records')).some((n) => n.startsWith(repId));
    const before = onDisk();
    r = await call('DELETE', '/records/reports/' + repId, O);
    ok('Patient removes the report, and the file is deleted from storage/records', r.status === 200 && before && !onDisk());
    f = await getFile(`/api/records/reports/${repId}/file`, O);
    ok('The removed report can no longer be opened', f.status === 404);

    // ---------- 9. audit trail ----------
    await sleep(900);
    const want = ['RECORD_ADD', 'RECORD_REMOVE', 'REPORT_ADD', 'REPORT_REMOVE', 'RECORD_VIEW', 'RECORD_DENIED', 'RECORD_FILE_VIEW'];
    const au = await supabase.from('audit_log').select('action').gte('at', startedAt).in('action', want);
    const got = [...new Set((au.data || []).map((x) => x.action))];
    const missing = want.filter((x) => !got.includes(x));
    ok('audit_log recorded additions, removals, doctor views and refused attempts', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : '');
  } catch (e) {
    console.log('  FAIL  Unexpected error: ' + e.message); failed++;
  } finally {
    try { if (D) await call('POST', '/doctor/online', D, { online: false }); } catch {}
    // Best-effort cleanup of everything the test created.
    const quiet = async (p) => { try { await p; } catch {} };
    if (apptIds.length) {
      for (const t of ['messages', 'appointment_keys', 'attachments', 'prescriptions', 'invoices', 'payments']) await quiet(supabase.from(t).delete().in('appointment_id', apptIds));
      await quiet(supabase.from('appointments').delete().in('id', apptIds));
    }
    if (slotIds.length) await quiet(supabase.from('doctor_slots').delete().in('id', slotIds));
    if (tempUsers.length) {
      await quiet(supabase.from('consult_requests').delete().in('patient_id', tempUsers));
      await quiet(supabase.from('queue_entries').delete().in('patient_id', tempUsers));
      await quiet(supabase.from('users').delete().in('id', tempUsers));
    }
  }
  console.log(failed ? `\n${failed} check(s) FAILED. Send me the lines above.\n` : '\nAll Day 10 checks passed. Now do the live test in the browser (steps in the chat), then close Day 10.\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });
