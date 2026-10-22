-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day10.sql)
-- Day 10: the patient medical record. Safe to run more than once.

-- 1. Allergies and conditions that the patient enters.
create table if not exists medical_history (
  id          text primary key,
  patient_id  text not null references users(id) on delete cascade,
  kind        text not null check (kind in ('allergy', 'condition')),
  name        text not null,
  note        text not null default '',
  severity    text check (severity in ('mild', 'moderate', 'severe')),   -- allergies only
  created_at  timestamptz not null default now()
);
create index if not exists idx_history_patient on medical_history(patient_id, created_at desc);
-- The same allergy or condition cannot be added twice (capital letters do not matter).
create unique index if not exists uq_history_name on medical_history(patient_id, kind, lower(name));

-- 2. Reports the patient uploads to their record (the files stay on your laptop in storage/records).
create table if not exists record_reports (
  id           text primary key,
  patient_id   text not null references users(id) on delete cascade,
  title        text not null,
  filename     text not null,
  mime         text not null,
  size         integer not null,
  file_path    text not null,
  report_date  date,
  created_at   timestamptz not null default now()
);
create index if not exists idx_reports_patient on record_reports(patient_id, created_at desc);

-- Same rule as every other table: only your server (service-role key) can touch them.
alter table medical_history enable row level security;
alter table record_reports  enable row level security;

-- Tells Supabase to notice the new tables right away.
notify pgrst, 'reload schema';
