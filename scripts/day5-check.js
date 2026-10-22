// PASTE AS: scripts/day5-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day5-check.js
// 1) two patients race for ONE slot at the same instant: exactly one must win
// 2) the winner cannot hold two overlapping slots (with another doctor)
// 3) the patient cancels, the slot becomes free, the other patient can now book it
// 4) the doctor cancels a booking, the slot disappears
// 5) the doctor's working hours can be changed
// It creates one temporary test patient and deletes it at the end.
const { supabase } = require('../server/supabase');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const allSlots = (d) => d.days.flatMap((x) => x.slots);

(async () => {
  console.log('\nDay 5 check against ' + BASE + '\n');
  let testUserId = null;
  try {
    const a = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
    const em = 'race' + Date.now() + '@pulscare.test';
    const b = await call('POST', '/auth/register', null, { fullName: 'Race Tester', email: em, password: 'patient123' });
    const d1 = await call('POST', '/auth/doctor-login', null, { doctorId: 'DOC-1003', password: 'doctor123' });
    ok('Two patients and a doctor can log in', a.status === 200 && b.status === 200 && d1.status === 200);
    if (!(a.status === 200 && b.status === 200 && d1.status === 200)) return;
    testUserId = b.data.user.id;
    const A = a.data.token, B = b.data.token, D = d1.data.token;

    // 1. Race
    const list = await call('GET', '/doctors/DOC-1003/slots', A);
    const free = list.status === 200 ? allSlots(list.data).filter((s) => !s.booked) : [];
    ok('Doctor has free slots for the next 7 days', free.length > 0, free.length + ' free');
    if (!free.length) return;
    const target = free[Math.min(5, free.length - 1)];
    const [ra, rb] = await Promise.all([
      call('POST', `/slots/${target.id}/book`, A, { reason: 'race A' }),
      call('POST', `/slots/${target.id}/book`, B, { reason: 'race B' })
    ]);
    const codes = [ra.status, rb.status].sort();
    ok('Race: exactly one patient wins (200) and the other is refused (409)', codes[0] === 200 && codes[1] === 409, codes.join(','));
    const winner = ra.status === 200 ? { tok: A, res: ra, other: B } : { tok: B, res: rb, other: A };
    if (ra.status !== 200 && rb.status !== 200) return;
    ok('Winner gets an appointment id', !!winner.res.data.appointmentId, winner.res.data.appointmentId);

    const { count } = await supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('slot_id', target.id);
    ok('Only ONE appointment exists for that slot', count === 1, 'count=' + count);

    // 2. Overlap with another doctor at the same time
    const other = await call('GET', '/doctors/DOC-1001/slots', winner.tok);
    const same = other.status === 200 && allSlots(other.data).find((s) => s.startsAt === target.startsAt && !s.booked);
    if (same) {
      const ov = await call('POST', `/slots/${same.id}/book`, winner.tok, {});
      ok('Same patient cannot book an overlapping slot with another doctor', ov.status === 409 && ov.data.code === 'PATIENT_BUSY', 'status ' + ov.status);
    } else console.log('  SKIP  overlap test (the other doctor has no slot at the same minute)');

    // 3. Patient cancels, the other patient takes it
    const cx = await call('POST', `/slots/${target.id}/cancel`, winner.other, {});
    ok('A stranger cannot cancel someone else\'s booking', cx.status === 403, 'status ' + cx.status);
    const c1 = await call('POST', `/slots/${target.id}/cancel`, winner.tok, {});
    ok('Patient can cancel their own booking', c1.status === 200);
    const again = await call('POST', `/slots/${target.id}/book`, winner.other, { reason: 'second chance' });
    ok('The freed slot can now be booked by the other patient', again.status === 200, 'status ' + again.status);

    // 4. Doctor cancels
    const c2 = await call('POST', `/slots/${target.id}/cancel`, D, {});
    ok('Doctor can cancel the booking', c2.status === 200, 'status ' + c2.status);
    const after = await call('GET', '/doctors/DOC-1003/slots', A);
    ok('That slot is gone after the doctor cancelled it', after.status === 200 && !allSlots(after.data).some((s) => s.id === target.id));

    // 5. Working hours
    const cur = await call('GET', '/doctor/schedule', D);
    ok('Doctor can read working hours', cur.status === 200 && Array.isArray(cur.data.schedule.days));
    const bad = await call('PUT', '/doctor/schedule', D, { days: [1], start: '17:00', end: '09:00', slotMinutes: 15 });
    ok('End before start is refused', bad.status === 400);
    const sv = await call('PUT', '/doctor/schedule', D, cur.data.schedule);
    ok('Saving the same hours works and rebuilds free slots', sv.status === 200 && sv.data.slotsCreated >= 0, 'created ' + (sv.data && sv.data.slotsCreated));
    const pt = await call('PUT', '/doctor/schedule', A, cur.data.schedule);
    ok('A patient cannot change a doctor\'s hours', pt.status === 403);

    // Audit trail
    const log = await supabase.from('audit_log').select('action').in('action', ['SLOT_BOOK', 'SLOT_BOOK_REJECTED', 'SLOT_CANCEL', 'SCHEDULE_SAVE']).gte('at', new Date(Date.now() - 120000).toISOString());
    const seen = new Set((log.data || []).map((x) => x.action));
    ok('Booking, rejected booking, cancel and schedule save are all in audit_log', ['SLOT_BOOK', 'SLOT_BOOK_REJECTED', 'SLOT_CANCEL', 'SCHEDULE_SAVE'].every((x) => seen.has(x)), [...seen].join(','));
  } catch (e) {
    ok('Check ran without an unexpected error', false, e.message);
  } finally {
    if (testUserId) {
      await supabase.from('doctor_slots').update({ patient_id: null, booked_at: null }).eq('patient_id', testUserId);
      const ap = await supabase.from('appointments').select('id').eq('patient_id', testUserId);
      for (const x of ap.data || []) await supabase.from('appointments').delete().eq('id', x.id);
      await supabase.from('users').delete().eq('id', testUserId);
    }
    console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nAll Day 5 checks passed\n');
    process.exit(failed ? 1 : 0);
  }
})();
