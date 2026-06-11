-- Keeps opportunity_occurrences.status in sync with its confirmed bookings:
-- an occurrence is 'booked' only when its confirmed booking count reaches the
-- parent's slot_count, and reopens when a cancellation drops it back below —
-- but only for FUTURE dates (past occurrences are history, and completion
-- flips confirmed -> completed without reopening anything).
--
-- A trigger (SECURITY DEFINER) rather than app code because the two writers
-- sit on opposite sides of RLS: the provider who accepts an offer creates
-- booking_occurrences rows but has no UPDATE right on opportunity_occurrences
-- (that table is org-poster-only), and the org cancels its side the same way.

create or replace function public.sync_occurrence_booked_status() returns trigger
language plpgsql security definer set search_path = public as $f$
declare
  occ record;
  confirmed_count int;
  slots int;
begin
  select oo.id, oo.status, oo.starts_at, o.slot_count
    into occ
    from public.opportunity_occurrences oo
    join public.opportunities o on o.id = oo.opportunity_id
    where oo.id = coalesce(new.occurrence_id, old.occurrence_id)
    for update of oo;
  if occ.id is null then
    return coalesce(new, old);
  end if;
  slots := occ.slot_count;

  select count(*) into confirmed_count
    from public.booking_occurrences bo
    where bo.occurrence_id = occ.id and bo.status = 'confirmed';

  -- Hard overbooking stop: two providers accepting the last slot at the same
  -- moment serialize on the FOR UPDATE above, and the loser fails here.
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'confirmed' and confirmed_count > slots then
    raise exception 'occurrence % is fully booked', occ.id;
  end if;

  if confirmed_count >= slots and occ.status = 'open' then
    update public.opportunity_occurrences set status = 'booked' where id = occ.id;
  elsif confirmed_count < slots and occ.status = 'booked' and occ.starts_at > now() then
    update public.opportunity_occurrences set status = 'open' where id = occ.id;
  end if;

  return coalesce(new, old);
end
$f$;

drop trigger if exists sync_occurrence_booked on public.booking_occurrences;
create trigger sync_occurrence_booked
  after insert or update of status or delete on public.booking_occurrences
  for each row execute function public.sync_occurrence_booked_status();

-- Trigger-only function: not directly callable by clients (advisor hardening).
revoke execute on function public.sync_occurrence_booked_status() from public, anon, authenticated;
