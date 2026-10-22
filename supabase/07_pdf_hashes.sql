-- PASTE INTO: Supabase > SQL Editor > New query > Run.   (file: supabase/day8.sql)
-- Day 8: a fingerprint (SHA-256) of each PDF file, so a changed or swapped file is detected. Safe to run more than once.
alter table prescriptions add column if not exists file_sha256 text;
alter table invoices      add column if not exists file_sha256 text;

-- Tells Supabase to notice the new columns right away.
notify pgrst, 'reload schema';
