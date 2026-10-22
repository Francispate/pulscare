// PASTE AS: scripts/seed-supabase.js  (new file, create the "scripts" folder if it does not exist)
// Run once:  node scripts/seed-supabase.js
// Adds the 6 sample doctors and the demo patient to Supabase (skips any that already exist), then lists the doctors.
const bcrypt = require('bcryptjs');
const { supabase, check } = require('../server/supabase');

const DOCTORS = [
  ['DOC-1001', 'Dr. Deepak Kumar Pujar', 'Cardiology', 'MD, DM, DNB (Interventional Cardiology)', 'Cardiac catheterization and structural heart care.', 600, 'deepak.pujar@pulscare.test', 'English,Kannada,Hindi'],
  ['DOC-1002', 'Dr. Shivagouda Patil', 'Urology', 'MS, MCh (Urology & Transplant)', 'Advanced urological surgery and kidney transplantation.', 500, 'shivagouda.patil@pulscare.test', 'English,Kannada'],
  ['DOC-1003', 'Dr. Ramesh Ravindra Deshpande', 'General Medicine', 'MD (Internal Medicine)', 'Chronic disease care, fever triage and adult medicine.', 300, 'ramesh.deshpande@pulscare.test', 'English,Hindi,Marathi'],
  ['DOC-1004', 'Dr. Sheetal Ambar', 'Gynaecology', 'MS (Obstetrics & Gynaecology)', "Women's health, maternity care and laparoscopy.", 450, 'sheetal.ambar@pulscare.test', 'Kannada,Hindi,English'],
  ['DOC-1005', 'Dr. Priyadarashini Kulkarni', 'Paediatrics', 'MD, FPM (Paediatrics & Neonatology)', 'Child health, newborn care and growth checks.', 400, 'priyadarashini.kulkarni@pulscare.test', 'English,Kannada,Marathi'],
  ['DOC-1006', 'Dr. Shreepati Pise', 'General Surgery', 'FIAGES (General & Laparoscopic Surgery)', 'Keyhole surgery and surgical critical care.', 500, 'shreepati.pise@pulscare.test', 'English,Hindi,Kannada']
];

(async () => {
  const docHash = bcrypt.hashSync('doctor123', 10);
  const users = DOCTORS.map(([id, name, , , , , email, languages]) => ({ id, role: 'doctor', full_name: name, email, password_hash: docHash, languages }));
  users.push({ id: 'PT-DEMO01', role: 'patient', full_name: 'Demo Patient', email: 'demo@pulscare.test', password_hash: bcrypt.hashSync('patient123', 10) });
  // ignoreDuplicates: existing rows are left alone, so running this twice never overwrites anything
  check(await supabase.from('users').upsert(users, { onConflict: 'id', ignoreDuplicates: true }));
  const docs = DOCTORS.map(([id, , dept, qual, about, fee]) => ({ id, license_id: id, department: dept, qualification: qual, about, fee }));
  check(await supabase.from('doctors').upsert(docs, { onConflict: 'id', ignoreDuplicates: true }));

  const rows = check(await supabase.from('doctors').select('id, department, fee, users(full_name, languages)').order('id'));
  console.log(`\nSupabase connected. Doctors found: ${rows.length}\n`);
  for (const r of rows) console.log(`${r.id}  ${r.users.full_name.padEnd(34)} ${r.department.padEnd(17)} Rs ${r.fee}  [${r.users.languages}]`);
  console.log(rows.length === 6 ? '\nDay 2 check passed.' : '\nExpected 6 doctors. Check the steps again.');
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
