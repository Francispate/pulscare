// PASTE AS: scripts/day7-check.js  (new file)
// Run with the server RUNNING in another window:  node scripts/day7-check.js     (takes about 10 seconds)
// Tests the chat key backup: the server stores only a scrambled blob, only the owner can read it, a wrong passphrase fails,
// the right passphrase brings back the SAME key so an old message decrypts again, reset works, and the audit trail.
// It creates 2 temporary patients and cleans up after itself.
const fs = require('fs');
const path = require('path');
const { supabase } = require('../server/supabase');
const BASE = process.env.BASE || 'http://localhost:' + (process.env.PORT || 3000);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

async function call(method, p, token, body) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// Loads the REAL public/js/crypto.js (the same file the browser uses) so the test covers the real code.
function loadBrowserCrypto() {
  global.window = { crypto: globalThis.crypto };
  new Function(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'crypto.js'), 'utf8'))();
  return global.window.E2EE;
}

(async () => {
  console.log('\nDay 7 check against ' + BASE + '\n');
  const tempUsers = [];
  try {
    const mk = async (label) => {
      const r = await call('POST', '/auth/register', null, { fullName: 'Key ' + label, email: `k${label}${Date.now()}@pulscare.test`, password: 'patient123' });
      if (r.status !== 200) throw new Error('could not create test patient ' + label + ': ' + JSON.stringify(r.data));
      tempUsers.push(r.data.user.id);
      return { token: r.data.token, id: r.data.user.id };
    };
    const A = await mk('A'), B = await mk('B');

    let r = await call('GET', '/keys/backup');
    ok('Backup route needs a login', r.status === 401);

    r = await call('GET', '/keys/backup', A.token);
    ok('New user has no backup yet', r.status === 200 && r.data.backup === null);

    // --- the browser side: make a key, send a message to B, back the key up ---
    const alice = loadBrowserCrypto(); await alice.init(true);
    const bob = loadBrowserCrypto(); await bob.init(true);
    await alice.setPeer(bob.myPub); await bob.setPeer(alice.myPub);
    const oldMsg = await alice.encrypt('Message sent before the reload');
    const pub = alice.myPub;
    const blob = await alice.makeBackup('my long passphrase');

    r = await call('PUT', '/keys/backup', A.token, { ...blob, ciphertext: '***not base64***' });
    ok('A broken backup is refused', r.status === 400);
    r = await call('PUT', '/keys/backup', A.token, { ...blob, iterations: 5 });
    ok('A backup with weak settings is refused', r.status === 400);

    r = await call('PUT', '/keys/backup', A.token, blob);
    ok('Valid backup is saved', r.status === 200 && r.data.ok);

    // --- what the server really stores: nothing readable ---
    const row = await supabase.from('key_backups').select('*').eq('user_id', A.id).single();
    const stored = JSON.stringify(row.data || {});
    ok('Stored copy does not contain the passphrase', !stored.includes('my long passphrase'));
    ok('Stored copy is scrambled (no private key fields)', !/"d":|"kty"|"crv"/.test(stored));

    // --- only the owner can read it ---
    r = await call('GET', '/keys/backup', B.token);
    ok('Another patient cannot see it (gets nothing)', r.status === 200 && r.data.backup === null);

    // --- the "reload": a fresh browser, same person ---
    r = await call('GET', '/keys/backup', A.token);
    ok('After a reload the backup comes back', r.status === 200 && r.data.backup && r.data.backup.ciphertext === blob.ciphertext);
    const fresh = loadBrowserCrypto();
    let wrongRejected = false;
    try { await fresh.restore(r.data.backup, 'a wrong passphrase'); } catch { wrongRejected = true; }
    ok('Wrong passphrase is rejected', wrongRejected);
    await fresh.restore(r.data.backup, 'my long passphrase');
    ok('Right passphrase brings back the SAME chat key', fresh.myPub === pub);
    await fresh.setPeer(bob.myPub);
    let readBack = null; try { readBack = await fresh.decrypt(oldMsg.ciphertext, oldMsg.iv); } catch {}
    ok('The old message decrypts again after the reload', readBack === 'Message sent before the reload', JSON.stringify(readBack));
    const fromBob = await bob.encrypt('Reply from the other side');
    let reply = null; try { reply = await fresh.decrypt(fromBob.ciphertext, fromBob.iv); } catch {}
    ok('New messages from the other person decrypt too', reply === 'Reply from the other side');
    ok('Both sides still show the same key check code', fresh.fingerprint === bob.fingerprint);

    // --- reset ("I forgot my passphrase") ---
    r = await call('DELETE', '/keys/backup', A.token);
    ok('Reset removes the backup', r.status === 200);
    r = await call('GET', '/keys/backup', A.token);
    ok('After a reset there is no backup (a new key can be made)', r.data.backup === null);
    const lost = loadBrowserCrypto(); await lost.init(true); await lost.setPeer(bob.myPub);
    let stillLocked = false; try { await lost.decrypt(oldMsg.ciphertext, oldMsg.iv); } catch { stillLocked = true; }
    ok('After a reset the old message stays locked (as promised on screen)', stillLocked);

    // --- audit trail ---
    await new Promise((s) => setTimeout(s, 700));
    const a = await supabase.from('audit_log').select('action').eq('actor_id', A.id).like('action', 'KEY_BACKUP%');
    const acts = [...new Set((a.data || []).map((x) => x.action))].sort();
    ok('audit_log has KEY_BACKUP_FETCH, KEY_BACKUP_SAVE and KEY_BACKUP_RESET', ['KEY_BACKUP_FETCH', 'KEY_BACKUP_RESET', 'KEY_BACKUP_SAVE'].every((x) => acts.includes(x)), acts.join(','));
  } catch (e) {
    console.log('  FAIL  Unexpected error: ' + e.message); failed++;
  } finally {
    if (tempUsers.length) await supabase.from('users').delete().in('id', tempUsers);
  }
  console.log(failed ? `\n${failed} check(s) FAILED. Send me the lines above.\n` : '\nAll Day 7 checks passed. Now do the live test in the browser (steps in the chat), then close Day 7.\n');
  process.exit(failed ? 1 : 0);
})();
