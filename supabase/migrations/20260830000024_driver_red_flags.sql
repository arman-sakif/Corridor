-- Corridor — let the driver who was actually there flag a passenger
--
-- `red_flags_insert_operator` requires `is_operator_manager`, so an owner or
-- staff member can record a mark against a passenger and the driver cannot.
-- That is backwards: the person who watched somebody refuse to pay, or shout
-- at the other riders for two hours, is in the van. Today they can only reach
-- the two flags that fire automatically — `no_show` from `mark_no_show()` and
-- `did_not_pay` from `confirm_payment_as_driver(false)` — and neither carries
-- a note.
--
-- This is the other half of "a driver can report a passenger". It is a red
-- flag rather than a new kind of record on purpose: a flag is a quiet signal
-- between operators, shown to the next one at approval time, and that is
-- exactly the weight this should carry. An escalation to the platform is a
-- `report`, and it runs the other way.
--
-- The authorisation is the one `mark_no_show()` already uses: a manager of the
-- operator, or the driver assigned to that departure. It is a SECURITY DEFINER
-- function for the same reason every other driver write is — drivers hold no
-- write policy anywhere, so each of their changes goes through a function that
-- first proves they were on that trip.

create or replace function public.raise_red_flag(
  p_booking_id uuid,
  p_reason     public.red_flag_reason,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking   record;
  v_id        uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;

  select b.id, b.passenger_id, b.status, b.departure_id, d.operator_id
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  if not (
    public.is_operator_manager(v_booking.operator_id)
    or public.is_departure_driver(v_booking.departure_id)
  ) then
    raise exception 'Only this operator can flag that passenger.';
  end if;

  -- Nothing to judge until the seat was confirmed. A declined request or a
  -- lapsed hold never met anybody.
  if v_booking.status not in ('approved', 'completed', 'settled', 'no_show') then
    raise exception 'You can flag a passenger once the trip has been confirmed.';
  end if;

  insert into public.red_flags (booking_id, operator_id, passenger_id, reason, note, created_by)
  values (
    p_booking_id,
    v_booking.operator_id,
    v_booking.passenger_id,
    p_reason,
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.raise_red_flag(uuid, public.red_flag_reason, text) from public;
grant execute on function public.raise_red_flag(uuid, public.red_flag_reason, text) to authenticated;
