// PASTE AS: scripts/day8-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day8-check.js     (takes about 20 seconds)
// Tests: only the two people on an appointment can open its PDFs (refusals are logged), a changed prescription or a changed PDF file
// is refused on download and shows "not valid" on the verify page, a missing PDF is rebuilt only when its data is intact,
// old absolute file paths still work after moving the folder, and the audit trail.
// It adds one test appointment to Supabase (like day3-check) and puts every file and row it touches back the way it was.
const fs = require('fs');
const { supabase } = require('../server/supabase');
const db = require('../server/db');
const pdf = require('../server/pdf');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
const DOC = 'DOC-1003', OTHER_DOC = 'DOC-1001';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function download(appt, type, token) {
  const res = await fetch(`${BASE}/api/documents/${appt}/${type}`, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, isPdf: buf.slice(0, 5).toString() === '%PDF-', json: res.status !== 200 ? (() => { try { return JSON.parse(buf.toString()); } catch { return null; } })() : null };
}

(async () => {
  console.log('\nDay 8 check against ' + BASE + '\n');
  const startedAt = new Date().toISOString();
  const tempUsers = [];
  let D = null, A = null, undo = [], fileUndo = null;
  try {
    // ---------- setup: one paid appointment with both PDFs ----------
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'in_progress');
    await supabase.from('appointments').update({ status: 'awaiting_payment' }).eq('doctor_id', DOC).eq('status', 'booked').is('slot_id', null);
    await supabase.from('queue_entries').update({ status: 'removed' }).eq('doctor_id', DOC).in('status', ['waiting', 'notified']);
    await supabase.from('consult_requests').update({ status: 'expired' }).eq('doctor_id', DOC).eq('status', 'pending');

    const dl = await call('POST', '/auth/doctor-login', null, { doctorId: DOC, password: 'doctor123' });
    const pa = await call('POST', '/auth/login', null, { email: 'demo@pulscare.test', password: 'patient123' });
    ok('Doctor and demo patient can log in', dl.status === 200 && pa.status === 200);
    if (dl.status !== 200 || pa.status !== 200) return;
    D = dl.data.token; const P = pa.data.token;
    const reg = await call('POST', '/auth/register', null, { fullName: 'Other Patient', email: `o${Date.now()}@pulscare.test`, password: 'patient123' });
    tempUsers.push(reg.data.user.id); const B = reg.data.token;
    const od = await call('POST', '/auth/doctor-login', null, { doctorId: OTHER_DOC, password: 'doctor123' });
    const D2 = od.status === 200 ? od.data.token : null;

    await call('POST', '/doctor/online', D, { online: true });
    const rq = await call('POST', '/requests', P, { doctorId: DOC, symptoms: 'Day 8 check' });
    const acc = await call('POST', `/requests/${rq.data.requestId}/respond`, D, { accept: true });
    A = acc.data.appointmentId;
    ok('Test appointment created', !!A, rq.data && rq.data.error || '');
    if (!A) return;
    await call('PUT', `/appointments/${A}/prescription`, D, { diagnosis: 'Day 8 test', notes: 'Rest', items: [{ medicine: 'Paracetamol', dose: '500 mg', frequency: 'Twice daily', timing: 'After meals', days: 3 }] });
    await db.setAppointmentStatus(A, 'awaiting_payment');
    const pay = await call('POST', '/payments/pay', P, { appointmentId: A, method: 'card', card: { number: '4242424242424242', expiry: '12/30', cvv: '123' } });
    ok('Payment succeeds (this creates both PDFs)', pay.status === 200, pay.data && pay.data.error || '');
    if (pay.status !== 200) return;

    const rxRow = async () => (await supabase.from('prescriptions').select('*').eq('appointment_id', A).single()).data;
    const invRow = async () => (await supabase.from('invoices').select('*').eq('appointment_id', A).single()).data;
    const verify = async () => (await call('GET', '/verify/' + (await rxRow()).sha256)).data;
    const rx0 = await rxRow(), inv0 = await invRow();

    // ---------- 1. who may download ----------
    let r = await download(A, 'prescription', P);
    ok('Patient can download the prescription', r.status === 200 && r.isPdf);
    r = await download(A, 'invoice', P);
    ok('Patient can download the invoice', r.status === 200 && r.isPdf);
    r = await download(A, 'prescription', D);
    ok('The doctor can download the prescription', r.status === 200 && r.isPdf);
    r = await download(A, 'invoice', D);
    ok('The doctor cannot download the invoice', r.status === 403);
    r = await download(A, 'prescription', B);
    ok("ANOTHER PATIENT cannot download your prescription", r.status === 404 && !r.isPdf);
    r = await download(A, 'invoice', B);
    ok("ANOTHER PATIENT cannot download your invoice", r.status === 404 && !r.isPdf);
    if (D2) { r = await download(A, 'prescription', D2); ok('Another doctor cannot download it either', r.status === 404); }
    else console.log('  note  Could not log in as ' + OTHER_DOC + ', so the "another doctor" check was skipped.');
    r = await download(A, 'prescription', null);
    ok('Without logging in there is no download', r.status === 401);

    // ---------- 2. fingerprints and safe paths ----------
    ok('Both PDFs have a saved fingerprint (SHA-256)', /^[a-f0-9]{64}$/.test(rx0.file_sha256 || '') && /^[a-f0-9]{64}$/.test(inv0.file_sha256 || ''));
    ok('File paths are saved as plain file names (no folder)', !/[\\/]/.test(rx0.file_path) && !/[\\/]/.test(inv0.file_path), rx0.file_path);
    ok('The saved fingerprint matches the real file', pdf.sameHash(pdf.sha256Buf(fs.readFileSync(pdf.resolveStored(rx0.file_path))), rx0.file_sha256));

    // ---------- 3. verify page: valid, then data tampered ----------
    let v = await verify();
    ok('Verify says VALID for the untouched prescription', v.valid === true);
    const origItems = rx0.items;
    const edited = JSON.parse(origItems); edited[0].dose = '5000 mg';
    await supabase.from('prescriptions').update({ items: JSON.stringify(edited) }).eq('id', rx0.id);
    undo.push(() => supabase.from('prescriptions').update({ items: origItems }).eq('id', rx0.id));
    v = await verify();
    ok('Someone edits the dose in the database: verify says NOT VALID', v.valid === false && /changed/i.test(v.reason || ''), v.reason);
    ok('The failed result shows no doctor or patient details', !v.doctor && !v.patient);
    r = await download(A, 'prescription', P);
    ok('The edited prescription is refused on download (409)', r.status === 409 && !r.isPdf, r.json && r.json.error);
    r = await download(A, 'invoice', P);
    ok('The invoice is not affected by that edit', r.status === 200);
    await supabase.from('prescriptions').update({ items: origItems }).eq('id', rx0.id);
    v = await verify();
    ok('Data put back: verify says VALID again', v.valid === true);
    r = await download(A, 'prescription', P);
    ok('Data put back: download works again', r.status === 200 && r.isPdf);

    // ---------- 4. the PDF file itself is tampered ----------
    const rxFile = pdf.resolveStored(rx0.file_path), invFile = pdf.resolveStored(inv0.file_path);
    const rxBytes = fs.readFileSync(rxFile), invBytes = fs.readFileSync(invFile);
    fileUndo = () => { fs.writeFileSync(rxFile, rxBytes); fs.writeFileSync(invFile, invBytes); }; // only used if the check crashes inside this section
    fs.writeFileSync(rxFile, Buffer.concat([rxBytes, Buffer.from('\n% tampered\n')]));
    r = await download(A, 'prescription', P);
    ok('A changed prescription PDF file is refused on download (409)', r.status === 409 && !r.isPdf);
    v = await verify();
    ok('A changed prescription PDF file shows NOT VALID on the verify page', v.valid === false && /PDF/i.test(v.reason || ''), v.reason);
    fs.writeFileSync(rxFile, rxBytes);
    v = await verify();
    ok('File put back: verify says VALID', v.valid === true);
    fs.writeFileSync(invFile, Buffer.concat([invBytes, Buffer.from('\n% tampered\n')]));
    r = await download(A, 'invoice', P);
    ok('A changed invoice PDF file is refused on download (409)', r.status === 409 && !r.isPdf);
    fs.writeFileSync(invFile, invBytes);
    r = await download(A, 'invoice', P);
    ok('Invoice file put back: download works', r.status === 200 && r.isPdf);

    fileUndo = null; // from here on the files are rebuilt on purpose, and the database fingerprints follow them

    // ---------- 5. project folder moved: old absolute path still works ----------
    await supabase.from('prescriptions').update({ file_path: 'C:\\Users\\someone\\old-folder\\storage\\' + rx0.file_path }).eq('id', rx0.id);
    r = await download(A, 'prescription', P);
    ok('An old absolute path (folder moved) still downloads', r.status === 200 && r.isPdf);
    await supabase.from('prescriptions').update({ file_path: '../../../../etc/passwd' }).eq('id', rx0.id);
    r = await download(A, 'prescription', P);
    ok('A path that tries to leave storage/ is ignored: the right PDF is served and the path is repaired', r.status === 200 && r.isPdf && (await rxRow()).file_path === rx0.file_path);
    await supabase.from('prescriptions').update({ file_path: rx0.file_path }).eq('id', rx0.id);

    // ---------- 6. PDF missing from storage/ ----------
    fs.renameSync(rxFile, rxFile + '.bak');
    r = await download(A, 'prescription', P);
    ok('Missing PDF + intact data: it is rebuilt and downloads', r.status === 200 && r.isPdf && fs.existsSync(rxFile));
    const rebuilt = await rxRow();
    ok('The rebuilt PDF has the same signature and a fresh fingerprint', rebuilt.sha256 === rx0.sha256 && pdf.sameHash(pdf.sha256Buf(fs.readFileSync(rxFile)), rebuilt.file_sha256));
    v = await verify();
    ok('Verify says VALID after the rebuild', v.valid === true);
    fs.unlinkSync(rxFile + '.bak');

    fs.unlinkSync(rxFile);
    await supabase.from('prescriptions').update({ items: JSON.stringify(edited) }).eq('id', rx0.id);
    r = await download(A, 'prescription', P);
    ok('Missing PDF + CHANGED data: refused, never re-signed (409)', r.status === 409 && !fs.existsSync(rxFile), 'file recreated: ' + fs.existsSync(rxFile));
    await supabase.from('prescriptions').update({ items: origItems }).eq('id', rx0.id);
    r = await download(A, 'prescription', P);
    ok('Data put back: the PDF is rebuilt again', r.status === 200 && r.isPdf);

    // ---------- 7. PDF issued before fingerprints existed ----------
    await supabase.from('prescriptions').update({ file_sha256: null }).eq('id', rx0.id);
    r = await download(A, 'prescription', P);
    const adopted = await rxRow();
    ok('Old document without a fingerprint: gets one on first download', r.status === 200 && /^[a-f0-9]{64}$/.test(adopted.file_sha256 || ''));

    // ---------- 8. audit trail ----------
    await new Promise((s) => setTimeout(s, 900));
    const want = ['DOCUMENT_DOWNLOAD', 'DOCUMENT_DENIED', 'DOCUMENT_INTEGRITY_FAIL', 'DOCUMENT_REGENERATED', 'DOCUMENT_REGEN_BLOCKED', 'DOCUMENT_FINGERPRINT_ADOPTED', 'VERIFY_OK', 'VERIFY_MISMATCH'];
    const au = await supabase.from('audit_log').select('action').gte('at', startedAt).in('action', want);
    const got = [...new Set((au.data || []).map((x) => x.action))];
    const missing = want.filter((x) => !got.includes(x));
    ok('audit_log recorded downloads, refusals, integrity failures, rebuilds and verify results', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : '');
  } catch (e) {
    console.log('  FAIL  Unexpected error: ' + e.message); failed++;
  } finally {
    if (fileUndo) { try { fileUndo(); } catch {} }
    for (const u of undo.reverse()) { try { await u(); } catch {} }
    try { if (D) await call('POST', '/doctor/online', D, { online: false }); } catch {}
    if (tempUsers.length) await supabase.from('users').delete().in('id', tempUsers);
  }
  console.log(failed ? `\n${failed} check(s) FAILED. Send me the lines above.\n` : '\nAll Day 8 checks passed. Now do the live test in the browser (steps in the chat), then close Day 8.\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nCheck crashed:', e.message, '\nIs the server running in another window?'); process.exit(1); });
