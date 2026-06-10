-- Constraints and triggers drizzle-kit 0.28 cannot emit. Applied once,
-- tracked in public.manual_migrations by src/db/migrate.ts.

-- profiles 1:1 auth.users (auth schema is unmanaged by drizzle).
do $$ begin
  if not exists (select from pg_constraint where conname = 'profiles_id_auth_users_fk') then
    alter table public.profiles
      add constraint profiles_id_auth_users_fk
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
exception when others then
  raise notice 'profiles -> auth.users FK skipped: %', sqlerrm;
end $$;

-- Auto-create a profile row on signup.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(to_jsonb(new) -> 'raw_user_meta_data' ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end
$f$;

do $$ begin
  if not exists (select from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user();
  end if;
exception when others then
  raise notice 'auth.users trigger skipped: %', sqlerrm;
end $$;

-- credential_requirements: at least one attachment point.
do $$ begin
  if not exists (select from pg_constraint where conname = 'credential_requirements_attachment_check') then
    alter table public.credential_requirements
      add constraint credential_requirements_attachment_check
      check (provider_type_id is not null or service_category_id is not null or service_id is not null);
  end if;
end $$;

-- THE no-hidden-pay rule, enforced in the database: shift-family posts must
-- show fixed pay, a range, or a negotiable-with-minimum.
do $$ begin
  if not exists (select from pg_constraint where conname = 'opportunities_pay_visibility_check') then
    alter table public.opportunities
      add constraint opportunities_pay_visibility_check
      check (
        type not in ('one_time_shift', 'recurring_shift', 'popup_event', 'contract')
        or (
          pay_kind is not null
          and pay_unit is not null
          and pay_min_cents is not null
          and (
            (pay_kind = 'fixed' and (pay_max_cents is null or pay_max_cents = pay_min_cents))
            or (pay_kind = 'range' and pay_max_cents > pay_min_cents)
            or (pay_kind = 'negotiable_min' and pay_max_cents is null)
          )
        )
      );
  end if;
end $$;

-- Occurrence sanity.
do $$ begin
  if not exists (select from pg_constraint where conname = 'opportunity_occurrences_time_check') then
    alter table public.opportunity_occurrences
      add constraint opportunity_occurrences_time_check
      check (ends_at > starts_at);
  end if;
end $$;
