-- Bootstrap: runs BEFORE drizzle migrations, idempotently, on every migrate.
-- Provisions extensions, roles, the auth shim (for local/CI Postgres — all
-- guarded so the same file is a safe no-op on Supabase), and the SECURITY
-- DEFINER helper functions that RLS policies reference. Helpers are created
-- with check_function_bodies=off because the tables they reference are
-- created later by drizzle migrations.

set check_function_bodies = off;

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists postgis;

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Supabase already has anon/authenticated/service_role; create them when
-- running against plain Postgres (local Postgres.app, CI container).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- The app's login role. NOINHERIT + fail-closed: without dbAs() injecting
-- set_config('role','authenticated'), rls_client has NO table privileges at
-- all — a forgotten claim injection yields zero rows, never leaked rows.
do $$ begin
  if not exists (select from pg_roles where rolname = 'rls_client') then
    create role rls_client login password '__RLS_CLIENT_PASSWORD__' noinherit;
  else
    alter role rls_client password '__RLS_CLIENT_PASSWORD__';
  end if;
end $$;
grant anon, authenticated to rls_client;

-- ── auth shim (local/CI only — every piece skips itself on Supabase) ───────
create schema if not exists auth;

do $$ begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  end if;
end $$;

do $$ begin
  if not exists (
    select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
    language sql stable as $f$
      select nullif(
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub',
        ''
      )::uuid
    $f$;
  end if;

  if not exists (
    select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    create function auth.jwt() returns jsonb
    language sql stable as $f$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $f$;
  end if;
end $$;

do $$ begin
  grant usage on schema auth to anon, authenticated, service_role;
exception when others then
  raise notice 'auth schema grants skipped: %', sqlerrm;
end $$;

-- ── RLS policy helpers ──────────────────────────────────────────────────────
-- STABLE SECURITY DEFINER: they run as the function owner, so they read the
-- membership tables WITHOUT recursive RLS evaluation. Policies wrap calls in
-- (select …) so Postgres caches the result per statement.

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $f$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  )
$f$;

create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  )
$f$;

-- Role ladder: owner ⊃ admin ⊃ poster.
create or replace function public.has_org_role(org uuid, min_role text) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and case min_role
            when 'owner'  then m.role = 'owner'
            when 'admin'  then m.role in ('owner', 'admin')
            else               m.role in ('owner', 'admin', 'poster')
          end
  )
$f$;

create or replace function public.my_provider_profile_id() returns uuid
language sql stable security definer set search_path = public as $f$
  select pp.id from public.provider_profiles pp where pp.user_id = auth.uid()
$f$;

-- The single privacy gate: does one of MY orgs hold an unrevoked grant from
-- this provider (auto-created on application, revocable by the provider)?
create or replace function public.org_has_grant(provider uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (
    select 1
    from public.profile_access_grants g
    join public.organization_members m on m.organization_id = g.organization_id
    where g.provider_profile_id = provider
      and g.revoked_at is null
      and m.user_id = auth.uid()
  )
$f$;

-- Definer to avoid self-referencing-policy recursion on thread_participants.
create or replace function public.is_thread_participant(thread uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (
    select 1 from public.thread_participants tp
    where tp.thread_id = thread and tp.user_id = auth.uid()
  )
$f$;

-- ── Append-only log writers ─────────────────────────────────────────────────
-- Direct DML on audit_logs / document_access_logs is revoked from clients
-- (drizzle/manual grants); these definer functions are the only write path.

create or replace function public.record_audit(
  p_acting_as text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid default null,
  p_changes jsonb default '{}'::jsonb,
  p_ip text default null,
  p_user_agent text default null
) returns void
language sql security definer set search_path = public as $f$
  insert into public.audit_logs
    (actor_user_id, acting_as, organization_id, action, entity_type, entity_id, changes, ip, user_agent)
  values
    (auth.uid(), p_acting_as, p_organization_id, p_action, p_entity_type, p_entity_id, p_changes, p_ip, p_user_agent)
$f$;

create or replace function public.record_document_access(
  p_provider_profile_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_access_kind text,
  p_organization_id uuid default null
) returns void
language sql security definer set search_path = public as $f$
  insert into public.document_access_logs
    (accessor_user_id, organization_id, provider_profile_id, document_kind, document_id, access_kind)
  values
    (auth.uid(), p_organization_id, p_provider_profile_id, p_document_kind, p_document_id, p_access_kind)
$f$;

grant execute on function
  public.is_platform_admin(),
  public.is_org_member(uuid),
  public.has_org_role(uuid, text),
  public.my_provider_profile_id(),
  public.org_has_grant(uuid),
  public.is_thread_participant(uuid),
  public.record_audit(text, text, text, uuid, uuid, jsonb, text, text),
  public.record_document_access(uuid, text, uuid, text, uuid)
to anon, authenticated, service_role;
