// PASTE AS: scripts/day11-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day11-check.js     (takes about 20 seconds)
// Tests the admin panel: only an admin gets in, an admin can add a doctor, and when an admin DISABLES a doctor that doctor can no longer
// go online, log in, be found, be requested or be booked, and their upcoming bookings are cancelled. Enabling brings them back.
// It creates a temporary admin, a temporary doctor and a temporary patient, and removes them at the end. It never touches your real doctors.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('../server/supabase');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function waitForNote(token, kind, since, seconds = 6) {
  for (let i = 0; i < seconds * 2; i++) {
    const b = (await call('GET', '/notifications', token)).data;
    const hit = b && b.items && b.items.find((n) => n.kind === kind && n.createdAt >= since);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

(async () => {
  console.log('\nDay 11 check against ' + BASE + '\n');
  const startedAt = new Date().toISOString();
  const stamp = Date.now().toString(36);
  const cleanup = { users: [], doctors: [] };
  try {
    // ---------- temporary admin (created straight in the database, like scripts/create-admin.js does) ----------
    const adminPw = 'Check-' + crypto.randomBytes(6).toString('hex');
    const adminEmail = `admin-${stamp}@pulscare.test`, adminId = 'AD-T' + stamp.toUpperCase().slice(-5);
    const ia = await supabase.from('users').insert({ id: adminId, role: 'admin', full_name: 'Check Admin', email: adminEmail, password_hash: bcrypt.hashSync(adminPw, 10) });
    if (ia.error) throw new Error('could not create the test admin: ' + ia.error.message + ' (did you run supabase/10_admin_role.sql?)');
    cleanup.users.push(adminId);

    const pt = await call('POST', '/auth/register', null, { fullName: 'Admin Check Patient', email: `p-${stamp}@pulscare.test`, password: 'patient123' });
    cleanup.users.push(pt.data.user.id);
    const P = pt.data.token, Pid = pt.data.user.id;
    const dl = await call('POST', '/auth/doctor-login', null, { doctorId: 'DOC-1003', password: 'doctor123' });
    const realDoctor = dl.data && dl.data.token;

    // ---------- 1. only an admin gets in ----------
    let r = await call('GET', '/admin/stats');
    ok('The admin area needs a login (401)', r.status === 401);
    r = await call('GET', '/admin/stats', P);
    ok('A patient is refused (403)', r.status === 403);
    r = await call('GET', '/admin/doctors', realDoctor);
    ok('A doctor is refused (403)', r.status === 403);
    r = await call('POST', '/auth/admin-login', null, { email: adminEmail, password: 'not the password' });
    ok('A wrong admin password is refused (401)', r.status === 401);
    r = await call('POST', '/auth/admin-login', null, { email: `p-${stamp}@pulscare.test`, password: 'patient123' });
    ok('A patient cannot log in through the admin login (401)', r.status === 401);
    r = await call('POST', '/auth/admin-login', null, { email: adminEmail, password: adminPw });
    ok('The admin can log in', r.status === 200 && r.data.user.role === 'admin');
    const A = r.data.token;

    // ---------- 2. counts ----------
    r = await call('GET', '/admin/stats', A);
    ok('The overview has counts', r.status === 200 && r.data.patients >= 1 && r.data.doctors.total >= 6 && typeof r.data.payments.revenue === 'number' && r.data.last24h && typeof r.data.last24h.loginsOk === 'number');

    // ---------- 3. add a doctor ----------
    const good = { fullName: 'Dr. Check Temporary', email: `doc-${stamp}@pulscare.test`, department: 'Check Dept', licenseId: 'TST-' + stamp.toUpperCase(), fee: 350, qualification: 'MBBS', about: 'Temporary test doctor' };
    r = await call('POST', '/admin/doctors', A, { ...good, email: 'not-an-email' });
    ok('A bad email is refused', r.status === 400);
    r = await call('POST', '/admin/doctors', A, { ...good, fullName: 'Dr' });
    ok('A too-short name is refused', r.status === 400);
    r = await call('POST', '/admin/doctors', A, { ...good, fee: 0 });
    ok('A fee of 0 is refused', r.status === 400);
    r = await call('POST', '/admin/doctors', A, { ...good, licenseId: 'DOC-1003' });
    ok('A licence ID already in use is refused (409)', r.status === 409);
    r = await call('POST', '/admin/doctors', A, { ...good, email: 'ramesh.deshpande@pulscare.test' });
    ok('An email already in use is refused (409)', r.status === 409);
    r = await call('POST', '/admin/doctors', P, good);
    ok('A patient cannot add a doctor (403)', r.status === 403);
    r = await call('POST', '/admin/doctors', A, good);
    ok('The admin adds a doctor and gets a one-time password', r.status === 200 && /^DOC-\d+$/.test(r.data.doctor.id) && r.data.password.length >= 10, r.data && r.data.doctor && r.data.doctor.id);
    if (r.status !== 200) throw new Error('could not add the test doctor: ' + JSON.stringify(r.data));
    const docId = r.data.doctor.id, docPw = r.data.password;
    cleanup.users.push(docId); cleanup.doctors.push(docId);
    const stored = await supabase.from('users').select('password_hash').eq('id', docId).single();
    ok('The password is stored scrambled (bcrypt), not readable', stored.data.password_hash !== docPw && stored.data.password_hash.startsWith('$2'));
    r = await call('GET', '/admin/doctors', A);
    const row = r.data.find((d) => d.id === docId);
    ok('The new doctor is in the admin list, not disabled', !!row && row.disabled === false && row.department === 'Check Dept');
    r = await call('POST', '/auth/doctor-login', null, { doctorId: docId, password: docPw });
    ok('The new doctor can log in with the one-time password', r.status === 200);
    let D = r.data.token;
    r = await call('GET', '/doctors');
    ok('Patients can see the new doctor', r.data.some((d) => d.id === docId));
    r = await call('POST', '/doctor/online', D, { online: true });
    ok('The new doctor can go online', r.status === 200 && r.data.online === true);

    // a booked visit 2 days from now, so we can see it cancelled
    const starts = new Date(Date.now() + 2 * 24 * 3600000), slotId = 'SLT-T11' + stamp.toUpperCase(), apptId = 'APT-T11' + stamp.toUpperCase();
    const s1 = await supabase.from('doctor_slots').insert({ id: slotId, doctor_id: docId, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 15 * 60000).toISOString(), patient_id: Pid, booked_at: new Date().toISOString() });
    if (s1.error) throw new Error('could not create the test slot: ' + s1.error.message);
    const a1 = await supabase.from('appointments').insert({ id: apptId, patient_id: Pid, doctor_id: docId, room_id: crypto.randomBytes(12).toString('hex'), fee: 350, status: 'booked', slot_id: slotId });
    if (a1.error) throw new Error('could not create the test booking: ' + a1.error.message);

    // ---------- 4. DISABLE ----------
    r = await call('POST', `/admin/doctors/${docId}/disable`, P, { reason: 'x' });
    ok('A patient cannot disable a doctor (403)', r.status === 403);
    const since = new Date().toISOString();
    r = await call('POST', `/admin/doctors/${docId}/disable`, A, { reason: 'Day 11 check' });
    ok('The admin disables the doctor', r.status === 200 && r.data.disabled === true && r.data.wasOnline === true, JSON.stringify(r.data));
    ok('Their upcoming booking was cancelled', r.data.cancelledBookings === 1);

    r = await call('POST', '/doctor/online', D, { online: true });
    ok('THE DISABLED DOCTOR CAN NO LONGER GO ONLINE (their old login stops working)', r.status === 401 && /disabled/i.test((r.data && r.data.error) || ''), (r.data && r.data.error) || '');
    r = await call('GET', '/appointments', D);
    ok('Their old login is refused everywhere else too', r.status === 401);
    r = await call('POST', '/auth/doctor-login', null, { doctorId: docId, password: docPw });
    ok('They cannot log in again (403, with a clear message)', r.status === 403 && /disabled/i.test(r.data.error));
    r = await call('POST', '/auth/doctor-login', null, { doctorId: docId, password: 'wrong password' });
    ok('A wrong password still just says "incorrect" (the account status is not leaked)', r.status === 401);
    const online = await supabase.from('doctors').select('is_online').eq('id', docId).single();
    ok('They were taken offline immediately', online.data.is_online === 0);
    r = await call('GET', '/doctors');
    ok('Patients no longer see them', !r.data.some((d) => d.id === docId));
    r = await call('POST', '/requests', P, { doctorId: docId, symptoms: 'check' });
    ok('A patient cannot send them a request (404)', r.status === 404);
    r = await call('GET', `/doctors/${docId}/slots`, P);
    ok('Their slots cannot be listed (404)', r.status === 404);
    const slotAfter = await supabase.from('doctor_slots').select('id, patient_id').eq('id', slotId).maybeSingle();
    const apptAfter = await supabase.from('appointments').select('id').eq('id', apptId).maybeSingle();
    ok('The cancelled booking is gone (slot freed or removed, appointment removed)', !apptAfter.data && !(slotAfter.data && slotAfter.data.patient_id));
    const note = await waitForNote(P, 'slot_cancelled', since);
    ok('The patient got a "Booking cancelled" alert that explains why', !!note && /no longer available/i.test(note.body), note && note.body);
    r = await call('POST', `/admin/doctors/${docId}/disable`, A, {});
    ok('Disabling twice gives 409', r.status === 409);
    r = await call('GET', '/admin/doctors', A);
    const dis = r.data.find((d) => d.id === docId);
    ok('The admin list shows them as disabled, with the reason', dis && dis.disabled === true && dis.disabledReason === 'Day 11 check' && dis.online === false);

    // ---------- 5. ENABLE ----------
    r = await call('POST', `/admin/doctors/${docId}/enable`, A);
    ok('The admin enables the doctor again', r.status === 200 && r.data.disabled === false);
    r = await call('POST', `/admin/doctors/${docId}/enable`, A);
    ok('Enabling twice gives 409', r.status === 409);
    r = await call('POST', '/auth/doctor-login', null, { doctorId: docId, password: docPw });
    ok('They can log in again', r.status === 200);
    D = r.data.token;
    r = await call('POST', '/doctor/online', D, { online: true });
    ok('...and go online again', r.status === 200 && r.data.online === true);
    r = await call('GET', '/doctors');
    ok('Patients see them again', r.data.some((d) => d.id === docId && d.online));
    await call('POST', '/doctor/online', D, { online: false });

    // ---------- 6. lists ----------
    r = await call('GET', '/admin/appointments?status=completed', A);
    ok('Appointments can be filtered by status', r.status === 200 && r.data.length > 0 && r.data.every((x) => x.status === 'completed') && r.data[0].patient && r.data[0].doctor);
    const anyAppt = r.data[0];
    r = await call('GET', '/admin/payments', A);
    ok('Payments list shows patient, doctor, amount and result', r.status === 200 && r.data.length > 0 && 'amount' in r.data[0] && ['paid', 'failed'].includes(r.data[0].status));
    r = await call('GET', '/admin/audit?group=LOGIN', A);
    ok('The audit log can be filtered to logins', r.status === 200 && r.data.length > 0 && r.data.every((e) => e.action.startsWith('LOGIN')));
    r = await call('GET', '/admin/audit?actor=' + docId, A);
    ok('The audit log can be filtered to one person', r.status === 200 && r.data.length > 0 && r.data.every((e) => e.actorId === docId));
    const page1 = (await call('GET', '/admin/audit?limit=5', A)).data;
    const page2 = (await call('GET', '/admin/audit?limit=5&before=' + page1[page1.length - 1].id, A)).data;
    ok('"Load older" gives older events without repeats', page1.length === 5 && page2.length > 0 && page2.every((e) => e.id < page1[page1.length - 1].id));
    r = await call('GET', '/admin/audit?group=a%27%20or%201=1', A);
    ok('A strange filter is ignored, not executed', r.status === 200);

    // ---------- 7. what an admin can NOT see ----------
    r = await call('GET', '/records/patient/' + Pid, A);
    ok("An admin cannot open a patient's medical record (403)", r.status === 403);
    r = await call('GET', '/records/me', A);
    ok('An admin has no medical record route either (403)', r.status === 403);
    if (anyAppt) {
      r = await call('GET', '/messages/' + anyAppt.id, A);
      ok("An admin cannot read an appointment's chat messages", r.status !== 200, 'status ' + r.status);
      const res = await fetch(`${BASE}/api/documents/${anyAppt.id}/prescription`, { headers: { Authorization: 'Bearer ' + A } });
      ok("An admin cannot download someone's prescription", res.status !== 200, 'status ' + res.status);
    }

    // ---------- 8. audit trail ----------
    await sleep(900);
    const want = ['DOCTOR_ADD', 'DOCTOR_DISABLE', 'DOCTOR_ENABLE', 'LOGIN_DISABLED', 'ADMIN_DENIED'];
    const au = await supabase.from('audit_log').select('action').gte('at', startedAt).in('action', want);
    const got = [...new Set((au.data || []).map((x) => x.action))];
    const missing = want.filter((x) => !got.includes(x));
    ok('audit_log recorded adding, disabling, enabling, the refused login and the refused admin attempts', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : '');
  } catch (e) {
    console.log('  FAIL  Unexpected error: ' + e.message); failed++;
  } finally {
    const quiet = async (p) => { try { await p; } catch {} };
    for (const id of cleanup.doctors) {
      await quiet(supabase.from('doctor_slots').delete().eq('doctor_id', id));
      await quiet(supabase.from('doctor_schedule').delete().eq('doctor_id', id));
      await quiet(supabase.from('doctors').delete().eq('id', id));
    }
    if (cleanup.users.length) await quiet(supabase.from('users').delete().in('id', cleanup.users));
  }
  console.log(failed ? `\n${failed} check(s) FAILED. Send me the lines above.\n` : '\nAll Day 11 checks passed. Now do the live test in the browser (steps in the chat), then close Day 11.\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });
