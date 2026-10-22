// PASTE AS: scripts/create-admin.js  (new file)
// Run once, with the server stopped or running:   node scripts/create-admin.js
// Creates an admin account. You type the email and password in this window. The password is hidden and is never saved anywhere readable.
// Admins can only be created here, never through the website.
require('dotenv').config();
const readline = require('readline');
const { Writable } = require('stream');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('../server/supabase');

function ask(question, hidden) {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
    muted = !!hidden; // the question is already on screen; what you type next stays hidden
  });
}

(async () => {
  console.log('\nCreate an admin account for Pulscare\n');
  const name = (await ask('Full name [Administrator]: ')).trim() || 'Administrator';
  const email = (await ask('Email (used to log in): ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('\nThat is not a valid email address.'); process.exit(1); }
  const exists = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (exists.error) { console.error('\nCould not reach Supabase: ' + exists.error.message); process.exit(1); }
  if (exists.data) { console.error('\nAn account with this email already exists.'); process.exit(1); }
  const pw = await ask('Password (at least 10 characters, hidden): ', true);
  if (pw.length < 10) { console.error('\nUse at least 10 characters.'); process.exit(1); }
  if (pw !== (await ask('Type it again (hidden): ', true))) { console.error('\nThe two passwords do not match. Nothing was created.'); process.exit(1); }

  const id = 'AD-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const ins = await supabase.from('users').insert({ id, role: 'admin', full_name: name, email, password_hash: bcrypt.hashSync(pw, 10) });
  if (ins.error) {
    console.error('\nCould not create the admin: ' + ins.error.message);
    if (/users_role_check|violates check/i.test(ins.error.message)) console.error('Run supabase/10_admin_role.sql in the Supabase SQL Editor first.');
    process.exit(1);
  }
  console.log(`\nAdmin created: ${name} (${id})\nLog in at http://localhost:${process.env.PORT || 3000}/admin.html with ${email}\n`);
  process.exit(0);
})();
