-- PASTE INTO: Supabase dashboard -> SQL Editor -> New query -> Run   (Day 4)
-- Audit log: one row per important event (login ok / failed / blocked, register, payment, document download).
-- No foreign keys on purpose: a failed login has no real user, and the log must survive if a user is ever removed.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  actor_id text,
  actor_role text,
  ip text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists idx_audit_at on audit_log(at desc);
create index if not exists idx_audit_action on audit_log(action, at desc);
create index if not exists idx_audit_actor on audit_log(actor_id, at desc);

-- Same lock as every other table: RLS on, no policies, so only the server's secret key can read or write.
alter table audit_log enable row level security;

notify pgrst, 'reload schema';
