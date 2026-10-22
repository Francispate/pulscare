-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day6.sql)
-- Day 6: waiting queue. Safe to run more than once.

create table if not exists queue_entries (
  id             text primary key,
  patient_id     text not null references users(id)   on delete cascade,
  doctor_id      text not null references doctors(id) on delete cascade,
  symptoms       text default '',
  status         text not null default 'waiting'
                 check (status in ('waiting','notified','joined','expired','cancelled','removed')),
  created_at     timestamptz not null default now(),
  notified_at    timestamptz,
  appointment_id text
);

create index if not exists idx_queue_doctor on queue_entries(doctor_id, status, created_at);

-- A patient can be in only ONE active queue at a time.
create unique index if not exists uq_queue_one_active_per_patient
  on queue_entries(patient_id) where status in ('waiting','notified');

-- A doctor can have only ONE patient being called at a time (stops two "your turn" alerts at once).
create unique index if not exists uq_queue_one_notified_per_doctor
  on queue_entries(doctor_id) where status = 'notified';

-- Same rule as every other table: only your server (service-role key) can touch it.
alter table queue_entries enable row level security;
