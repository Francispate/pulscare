-- PASTE INTO: Supabase dashboard -> SQL Editor -> New query -> Run   (Day 3)

-- FIX 1: the prescription "issued at" is a formatted text date that is part of the signed hash.
-- It must be stored exactly as written, so the column becomes text (the old SQLite version was text too).
alter table prescriptions alter column issued_at type text using issued_at::text;

-- FIX 2: one database transaction for the payment:
-- appointment marked paid -> payment saved -> invoice number allocated -> invoice saved.
-- If any step fails, nothing is saved. If the appointment was already paid, it is rejected (no double payment).
create or replace function complete_payment(
  p_pay_id text, p_inv_id text, p_appt_id text, p_label text, p_amount double precision, p_ref text
) returns text language plpgsql as $$
declare
  v_no text;
  v_rows integer;
begin
  update appointments
     set payment_status = 'paid', status = 'completed'
   where id = p_appt_id and payment_status = 'unpaid' and status = 'awaiting_payment';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'ALREADY_PAID_OR_NOT_READY';
  end if;

  insert into payments (id, appointment_id, method, amount, status, txn_ref)
  values (p_pay_id, p_appt_id, p_label, p_amount, 'paid', p_ref);

  v_no := next_invoice_no();
  insert into invoices (id, payment_id, appointment_id, invoice_no)
  values (p_inv_id, p_pay_id, p_appt_id, v_no);

  return v_no;
end;
$$;

revoke all on function complete_payment(text, text, text, text, double precision, text) from public, anon, authenticated;
grant execute on function complete_payment(text, text, text, text, double precision, text) to service_role;

notify pgrst, 'reload schema';
