-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day7.sql)
-- Day 7: chat key backup. Safe to run more than once.
-- The server stores only a scrambled (encrypted) copy of each person's chat key. It cannot open it: the passphrase never leaves the browser.

create table if not exists key_backups (
  user_id     text primary key references users(id) on delete cascade,
  public_key  text not null,
  salt        text not null,
  iv          text not null,
  ciphertext  text not null,
  iterations  integer not null check (iterations between 100000 and 2000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Same rule as every other table: only your server (service-role key) can touch it.
alter table key_backups enable row level security;
