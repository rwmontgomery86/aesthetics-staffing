-- New-message housekeeping that crosses RLS lines: a sender may only update
-- their OWN thread_participants row (update_self policy), and system
-- messages have no sender at all — so a SECURITY DEFINER trigger bumps the
-- thread's recency and the OTHER participants' unread counters on every
-- insert. markThreadRead (own-row, RLS-allowed) resets the counter.

create or replace function public.message_fanout() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  update public.threads
    set last_message_at = new.created_at
    where id = new.thread_id;
  update public.thread_participants
    set unread_count = unread_count + 1
    where thread_id = new.thread_id
      and (new.sender_user_id is null or user_id <> new.sender_user_id);
  return new;
end
$f$;

drop trigger if exists message_fanout on public.messages;
create trigger message_fanout
  after insert on public.messages
  for each row execute function public.message_fanout();

-- Trigger-only function: not directly callable by clients (advisor hardening).
revoke execute on function public.message_fanout() from public, anon, authenticated;
