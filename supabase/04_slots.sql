-- PASTE INTO: Supabase dashboard -> SQL Editor -> New query -> Run   (Day 5: slot booking)
-- Stop the server first, run this, then start the server again.

-- 1. The doctor working hours (one row per doctor). Times are Indian Standard Time (IST).
create table if not exists doctor_schedule (
  doctor_id text primary key references doctors(id) on delete cascade,
  days text not null default '1,2,3,4,5',            -- 0 = Sunday ... 6 = Saturday
  start_time text not null default '09:00',
  end_time text not null default '17:00',
  slot_minutes integer not null default 15 check (slot_minutes between 5 and 120),
  updated_at timestamptz not null default now()
);

-- 2. One row per bookable slot. patient_id is null while the slot is free.
--    UNIQUE (doctor_id, starts_at): a doctor can never have two slots at the same minute.
create table if not exists doctor_slots (
  id text primary key,
  doctor_id text not null references doctors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  patient_id text references users(id),
  booked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint slot_unique_time unique (doctor_id, starts_at),
  constraint slot_time_order check (ends_at > starts_at)
);
create index if not exists idx_slots_doctor_time on doctor_slots(doctor_id, starts_at);
create index if not exists idx_slots_patient on doctor_slots(patient_id, starts_at);

-- 3. Appointments remember which slot they came from.
--    UNIQUE slot_id: a slot can only ever have ONE appointment (second safety net against double booking).
alter table appointments add column if not exists slot_id text unique references doctor_slots(id);
alter table appointments add column if not exists reason text default '';

-- 4. Booking in ONE step. Two patients clicking at the same moment: the database lets the first one
--    change patient_id from NULL to their id; the second finds it already taken and gets SLOT_TAKEN_OR_PAST.
create or replace function book_slot(
  p_slot_id text, p_patient_id text, p_appt_id text, p_room text, p_reason text
) returns text language plpgsql as $$
declare
  v_slot doctor_slots%rowtype;
  v_fee double precision;
begin
  update doctor_slots
     set patient_id = p_patient_id, booked_at = now()
   where id = p_slot_id and patient_id is null and starts_at > now()
  returning * into v_slot;
  if not found then
    raise exception 'SLOT_TAKEN_OR_PAST';
  end if;

  -- The same patient cannot hold two overlapping slots (with any doctors).
  if exists (
    select 1 from doctor_slots s
     where s.patient_id = p_patient_id and s.id <> p_slot_id
       and s.starts_at < v_slot.ends_at and s.ends_at > v_slot.starts_at
  ) then
    raise exception 'PATIENT_BUSY';   -- undoes the claim above
  end if;

  select fee into v_fee from doctors where id = v_slot.doctor_id;
  insert into appointments (id, patient_id, doctor_id, room_id, fee, slot_id, reason)
  values (p_appt_id, p_patient_id, v_slot.doctor_id, p_room, v_fee, p_slot_id, left(coalesce(p_reason, ''), 300));
  return p_appt_id;
end;
$$;

-- 5. Cancelling a booked slot (by the patient who booked it, or by the doctor who owns it).
--    Only allowed before the call has started. A patient frees the slot; a doctor removes it.
create or replace function cancel_slot(p_slot_id text, p_actor_id text)
returns jsonb language plpgsql as $$
declare
  v_slot doctor_slots%rowtype;
  v_appt appointments%rowtype;
begin
  select * into v_slot from doctor_slots where id = p_slot_id for update;
  if not found then raise exception 'NO_SLOT'; end if;
  if v_slot.patient_id is null then raise exception 'NOT_BOOKED'; end if;
  if p_actor_id <> v_slot.patient_id and p_actor_id <> v_slot.doctor_id then raise exception 'NOT_ALLOWED'; end if;
  if v_slot.starts_at <= now() then raise exception 'ALREADY_STARTED'; end if;

  select * into v_appt from appointments where slot_id = p_slot_id for update;
  if found then
    if v_appt.status <> 'booked' then raise exception 'ALREADY_STARTED'; end if;
    delete from appointments where id = v_appt.id;
  end if;

  if p_actor_id = v_slot.doctor_id then
    delete from doctor_slots where id = p_slot_id;
  else
    update doctor_slots set patient_id = null, booked_at = null where id = p_slot_id;
  end if;
  return jsonb_build_object('patient_id', v_slot.patient_id, 'doctor_id', v_slot.doctor_id,
                            'starts_at', v_slot.starts_at, 'appointment_id', v_appt.id);
end;
$$;

-- Same lock as every other table: RLS on, no policies, so only the server secret key can read or write.
alter table doctor_schedule enable row level security;
alter table doctor_slots enable row level security;
revoke all on function book_slot(text, text, text, text, text) from public, anon, authenticated;
revoke all on function cancel_slot(text, text) from public, anon, authenticated;
grant execute on function book_slot(text, text, text, text, text) to service_role;
grant execute on function cancel_slot(text, text) to service_role;

notify pgrst, 'reload schema';
