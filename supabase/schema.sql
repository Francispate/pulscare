-- PASTE INTO: Supabase dashboard -> SQL Editor -> New query -> Run
-- Pulscare Day 2: all current tables, same column names as the SQLite version so Day 3 is a straight move.
-- Row-level security is ON for every table with NO public policies, so the browser (anon key) can read nothing.
-- Only your own server, using the secret / service_role key, can read and write.

create table if not exists users (
  id text primary key,
  role text not null check (role in ('patient','doctor')),
  full_name text not null,
  email text unique not null,
  password_hash text not null,
  phone text default '',
  preferred_language text default 'en',
  languages text default '',
  created_at timestamptz default now()
);

create table if not exists doctors (
  id text primary key references users(id),
  license_id text unique not null,
  department text not null,
  qualification text,
  about text,
  fee double precision not null default 300,
  is_online integer default 0
);

create table if not exists consult_requests (
  id text primary key,
  patient_id text not null references users(id),
  doctor_id text not null references doctors(id),
  symptoms text default '',
  status text default 'pending' check (status in ('pending','accepted','rejected','expired')),
  created_at timestamptz default now()
);

create table if not exists appointments (
  id text primary key,
  request_id text references consult_requests(id),
  patient_id text not null references users(id),
  doctor_id text not null references doctors(id),
  room_id text unique not null,
  fee double precision not null,
  status text default 'booked' check (status in ('booked','in_progress','awaiting_payment','completed')),
  payment_status text default 'unpaid' check (payment_status in ('unpaid','paid')),
  created_at timestamptz default now()
);

create table if not exists appointment_keys (
  appointment_id text not null references appointments(id),
  user_id text not null references users(id),
  public_key text not null,
  primary key (appointment_id, user_id)
);

-- Zero-knowledge chat: ciphertext + iv only. No plain-text column exists.
create table if not exists messages (
  id text primary key,
  appointment_id text not null references appointments(id),
  sender_id text not null references users(id),
  ciphertext text not null,
  iv text not null,
  created_at timestamptz default now()
);

create table if not exists prescriptions (
  id text primary key,
  appointment_id text unique not null references appointments(id),
  items text not null,
  notes text default '',
  diagnosis text default '',
  sha256 text,
  file_path text,
  issued_at timestamptz
);

create table if not exists payments (
  id text primary key,
  appointment_id text not null references appointments(id),
  method text not null,
  amount double precision not null,
  status text not null check (status in ('paid','failed')),
  txn_ref text,
  failure_reason text,
  created_at timestamptz default now()
);

create table if not exists invoices (
  id text primary key,
  payment_id text unique not null references payments(id),
  appointment_id text not null references appointments(id),
  invoice_no text unique not null,
  file_path text,
  created_at timestamptz default now()
);

create table if not exists attachments (
  id text primary key,
  appointment_id text not null references appointments(id),
  uploader_id text not null references users(id),
  filename text not null,
  mime text not null,
  size integer not null,
  file_path text not null,
  created_at timestamptz default now()
);

-- Invoice numbers INV-2026-1001, 1002, ... from a sequence (replaces the old "count rows" method, safe when two payments land together)
create sequence if not exists invoice_no_seq start 1001;
create or replace function next_invoice_no() returns text language sql as $$
  select 'INV-' || extract(year from now())::int || '-' || nextval('invoice_no_seq')
$$;
revoke all on function next_invoice_no() from public, anon, authenticated;
grant execute on function next_invoice_no() to service_role;

-- Helpful lookups
create index if not exists idx_requests_doctor on consult_requests(doctor_id, status);
create index if not exists idx_requests_patient on consult_requests(patient_id);
create index if not exists idx_appts_patient on appointments(patient_id);
create index if not exists idx_appts_doctor on appointments(doctor_id);
create index if not exists idx_messages_appt on messages(appointment_id, created_at);
create index if not exists idx_payments_appt on payments(appointment_id);
create index if not exists idx_attach_appt on attachments(appointment_id);

-- Lock every table: RLS on, no policies = no access for anon/authenticated. The server's secret key bypasses RLS.
alter table users enable row level security;
alter table doctors enable row level security;
alter table consult_requests enable row level security;
alter table appointments enable row level security;
alter table appointment_keys enable row level security;
alter table messages enable row level security;
alter table prescriptions enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table attachments enable row level security;

notify pgrst, 'reload schema';
