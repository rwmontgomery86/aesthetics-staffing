-- Review decisions are admin-only at the DATABASE level: providers may move
-- their credential through self_attested/document_uploaded/needs_review, but
-- only a platform admin (or the service role, which carries no JWT claims)
-- can set admin_reviewed / rejected_needs_info or touch reviewer fields.
-- RLS allows the owner to UPDATE the row; this trigger guards the columns.

create or replace function public.protect_credential_review_columns() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  -- Service-role/worker paths carry no JWT claims -> auth.uid() is null.
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('admin_reviewed', 'rejected_needs_info')
       or new.reviewed_by_user_id is not null
       or new.reviewed_at is not null
       or new.review_notes is not null then
      raise exception 'only platform admins can set credential review fields';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status in ('admin_reviewed', 'rejected_needs_info') then
    raise exception 'only platform admins can set credential review decisions';
  end if;

  if new.reviewed_by_user_id is distinct from old.reviewed_by_user_id
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_notes is distinct from old.review_notes then
    raise exception 'only platform admins can modify credential review fields';
  end if;

  -- A provider editing a reviewed credential (e.g. renewal upload) resets the
  -- decision so stale approvals can't linger on changed data.
  if old.status in ('admin_reviewed', 'rejected_needs_info')
     and (new.license_number is distinct from old.license_number
          or new.expires_at is distinct from old.expires_at
          or new.issuing_board is distinct from old.issuing_board
          or new.state is distinct from old.state) then
    new.status := 'needs_review';
    new.reviewed_by_user_id := null;
    new.reviewed_at := null;
  end if;

  return new;
end
$f$;

drop trigger if exists protect_credential_review on public.provider_credentials;
create trigger protect_credential_review
  before insert or update on public.provider_credentials
  for each row execute function public.protect_credential_review_columns();
