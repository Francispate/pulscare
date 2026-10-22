// PASTE AS: scripts/day6-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day6-check.js     (takes about 15 to 30 seconds)
// Tests: busy doctor -> patients queue in order, one queue per patient, "your turn" alert when the doctor is free,
// only the called patient can join, doctor can remove someone, going offline clears the queue, audit trail.
// It creates 3 temporary patients and cleans up after itself. Use doctor DOC-1003.
const { supabase } = require('../server/supabase');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
const DOC = 'DOC-1003';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  console.log('\nDay 6 check against ' + BASE + '\n');
  const tempUsers = [], apptIds = [], reqIds = [];
  let D = null;
  try {
    // --- start from a clean state for this doctor (only affects the doctor's own open demo items) ---
    const stale = await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'in_progress').select('id');
    const stale2 = await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'booked').is('slot_id', null).select('id');
    const n = (stale.data || []).length + (stale2.data || []).length;
    if (n) console.log(`  note  ${n} old open consultation(s) of ${DOC} were moved to "awaiting payment" so the doctor starts free.\n`);
    await supabase.from('queue_entries').update({ status: 'removed' }).eq('doctor_id', DOC).in('status', ['waiting', 'notified']);
    await supabase.from('consult_requests').update({ status: 'expired' }).eq('doctor_id', DOC).eq('status', 'pending');

    const mk = async (label) => {
      const email = `q${label}${Date.now()}@pulscare.test`;
      const r = await call('POST', '/auth/register', null, { fullName: 'Queue ' + label, email, password: 'patient123' });
      if (r.status !== 200) throw new Error('could not create test patient ' + label + ': ' + JSON.stringify(r.data));
      tempUsers.push(r.data.user.id);
      return r.data.token;
    };
    const dl = await call('POST', '/auth/doctor-login', null, { doctorId: DOC, password: 'doctor123' });
    const pa = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
    ok('Doctor and demo patient can log in', dl.status === 200 && pa.status === 200);
    if (dl.status !== 200 || pa.status !== 200) return;
    D = dl.data.token; const A = pa.data.token;
    const B = await mk('B'), C = await mk('C'), E = await mk('D');

    await call('POST', '/doctor/online', D, { online: true });

    // 1. Doctor is free: the normal request flow still works
    const ra = await call('POST', '/requests', A, { doctorId: DOC, symptoms: 'queue test' });
    ok('Free doctor: request is a normal request (not queued)', ra.status === 200 && !ra.data.queued && ra.data.requestId, JSON.stringify(ra.data));
    if (!ra.data || !ra.data.requestId) return;
    reqIds.push(ra.data.requestId);
    const acc = await call('POST', `/requests/${ra.data.requestId}/respond`, D, { accept: true });
    ok('Doctor accepts patient A: a call is now in progress', acc.status === 200 && acc.data.appointmentId);
    const apptA = acc.data.appointmentId; apptIds.push(apptA);

    // 2. Doctor busy: queue
    const list = await call('GET', '/doctors', A);
    const me = (list.data || []).find((d) => d.id === DOC);
    ok('Doctor card says busy', me && me.busy === true, JSON.stringify(me && { busy: me.busy, waiting: me.waiting }));
    const qb = await call('POST', '/requests', B, { doctorId: DOC, symptoms: 'B symptoms' });
    ok('Patient B is put in the queue at position 1', qb.status === 200 && qb.data.queued === true && qb.data.position === 1, JSON.stringify(qb.data));
    const qc = await call('POST', '/requests', C, { doctorId: DOC, symptoms: 'C symptoms' });
    ok('Patient C is put in the queue at position 2', qc.status === 200 && qc.data.queued === true && qc.data.position === 2, JSON.stringify(qc.data));
    const again = await call('POST', '/requests', B, { doctorId: DOC, symptoms: '' });
    ok('Patient B cannot join a second queue', again.status === 409, String(again.status));
    const dq = await call('GET', '/doctor/queue', D);
    ok('Doctor sees 2 waiting patients, in order', dq.status === 200 && dq.data.length === 2 && dq.data[0].patientName === 'Queue B', JSON.stringify((dq.data || []).map((x) => x.patientName)));
    const stray = await call('POST', `/queue/${qb.data.queueId}/join`, B);
    ok('Patient B cannot join before it is their turn', stray.status === 409, String(stray.status));

    // 3. The doctor "ends the call": the real app does this through a socket. Here the appointment is moved to awaiting_payment,
    //    and the server's 10 second sweeper must notice the doctor is free and call patient B.
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('id', apptA);
    let mine = null; const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      mine = await call('GET', '/queue/mine', B);
      if (mine.data && mine.data.entry && mine.data.entry.status === 'notified') break;
      await sleep(2000);
    }
    ok('Doctor is free: patient B is called ("Doctor is ready. Join now")', mine && mine.data.entry && mine.data.entry.status === 'notified', `after ${Math.round((Date.now() - t0) / 1000)}s`);
    const mc = await call('GET', '/queue/mine', C);
    ok('Patient C is still waiting, now at position 2', mc.data.entry && mc.data.entry.status === 'waiting' && mc.data.entry.position === 2, JSON.stringify(mc.data.entry));
    const cj = await call('POST', `/queue/${qc.data.queueId}/join`, C);
    ok('Patient C cannot jump the queue', cj.status === 409, String(cj.status));

    // 4. B joins
    const bj = await call('POST', `/queue/${qb.data.queueId}/join`, B);
    ok('Patient B presses Join now and gets an appointment', bj.status === 200 && !!bj.data.appointmentId, JSON.stringify(bj.data));
    if (bj.data && bj.data.appointmentId) apptIds.push(bj.data.appointmentId);
    const ap = bj.data && bj.data.appointmentId ? await supabase.from('appointments').select('status, patient_id, doctor_id, fee').eq('id', bj.data.appointmentId).maybeSingle() : { data: null };
    ok('That appointment is booked with the right doctor and fee', ap.data && ap.data.status === 'booked' && ap.data.doctor_id === DOC && ap.data.fee > 0);
    const mc2 = await call('GET', '/queue/mine', C);
    ok('Patient C is now #1 (doctor is in a call with B)', mc2.data.entry && mc2.data.entry.status === 'waiting' && mc2.data.entry.position === 1, JSON.stringify(mc2.data.entry));

    // 5. Doctor removes a waiting patient
    const qd = await call('POST', '/requests', E, { doctorId: DOC, symptoms: '' });
    ok('Patient D joins the queue behind C', qd.status === 200 && qd.data.queued && qd.data.position === 2, JSON.stringify(qd.data));
    const rm = await call('POST', `/queue/${qd.data.queueId}/remove`, D);
    ok('Doctor can remove patient D from the queue', rm.status === 200);
    const md = await call('GET', '/queue/mine', E);
    ok('Patient D is no longer in a queue', md.status === 200 && !md.data.entry);
    const rmB = await call('POST', `/queue/${qc.data.queueId}/remove`, A);
    ok('A patient cannot remove people from a doctor\'s queue', rmB.status === 403, String(rmB.status));

    // 6. Doctor goes offline: queue is cleared
    await call('POST', '/doctor/online', D, { online: false });
    const mc3 = await call('GET', '/queue/mine', C);
    ok('Doctor goes offline: the queue is cleared', mc3.status === 200 && !mc3.data.entry);

    // 7. Audit
    const au = await supabase.from('audit_log').select('action').in('action', ['QUEUE_JOIN', 'QUEUE_CALLED', 'QUEUE_JOINED_CALL', 'QUEUE_REMOVE']).gte('at', new Date(t0 - 120000).toISOString());
    const acts = new Set((au.data || []).map((x) => x.action));
    ok('audit_log has QUEUE_JOIN, QUEUE_CALLED, QUEUE_JOINED_CALL and QUEUE_REMOVE', ['QUEUE_JOIN', 'QUEUE_CALLED', 'QUEUE_JOINED_CALL', 'QUEUE_REMOVE'].every((x) => acts.has(x)), [...acts].join(','));
  } catch (e) {
    ok('Check ran without an unexpected error', false, e.message);
  } finally {
    try {
      if (D) await call('POST', '/doctor/online', D, { online: false });
      for (const id of apptIds) await supabase.from('appointments').delete().eq('id', id);
      for (const id of reqIds) await supabase.from('consult_requests').delete().eq('id', id);
      for (const id of tempUsers) { await supabase.from('queue_entries').delete().eq('patient_id', id); await supabase.from('users').delete().eq('id', id); }
    } catch (e) { console.log('  note  cleanup problem: ' + e.message); }
    console.log(failed ? `\n${failed} check(s) FAILED. Do not close Day 6 yet.\n` : '\nAll Day 6 checks passed. Now do the live test in the browser (steps in the chat), then close Day 6.\n');
    process.exit(failed ? 1 : 0);
  }
})();
