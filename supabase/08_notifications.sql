-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day9.sql)
-- Day 9: one table for every alert (bell icon). Safe to run more than once.
create table if not exists notifications (
  id          text primary key,
  user_id     text not null references users(id) on delete cascade,
  kind        text not null,                 -- new_request, queue_turn, slot_reminder, payment_done, new_attachment, slot_booked, slot_cancelled
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  dedupe_key  text,                          -- stops the same alert being created twice (for example a reminder after a restart)
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notif_user_time on notifications(user_id, created_at desc);
create index if not exists idx_notif_user_unread on notifications(user_id) where read_at is null;
create unique index if not exists uq_notif_dedupe on notifications(user_id, dedupe_key) where dedupe_key is not null;

-- Same rule as every other table: only your server (service-role key) can touch it.
alter table notifications enable row level security;

-- Tells Supabase to notice the new table right away.
notify pgrst, 'reload schema';
