-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day11.sql)
-- Day 11: the admin role, and a way to disable a doctor. Safe to run more than once.

-- 1. Users can now also have the role "admin".
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('patient', 'doctor', 'admin'));

-- 2. A doctor can be disabled by an admin (they cannot log in, go online or be booked) and enabled again later.
alter table doctors add column if not exists disabled        boolean not null default false;
alter table doctors add column if not exists disabled_at     timestamptz;
alter table doctors add column if not exists disabled_reason text;

-- Tells Supabase to notice the new column right away.
notify pgrst, 'reload schema';
