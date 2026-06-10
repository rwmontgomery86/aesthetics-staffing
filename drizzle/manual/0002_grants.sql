-- Table privileges. The model: grant broadly to authenticated, let
-- deny-by-default RLS policies be the real gate — EXCEPT append-only /
-- system-written tables, where direct DML is revoked outright so even a
-- policy mistake can't open them (writes go through SECURITY DEFINER
-- functions or the service role).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Append-only logs: definer-function writes only.
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.document_access_logs from anon, authenticated;
revoke update, delete on public.sms_consent_log from anon, authenticated;

-- System-written: dispatcher / matching worker / webhooks (service role) only.
revoke insert on public.notifications from anon, authenticated;
revoke insert, update, delete on public.notification_deliveries from anon, authenticated;
revoke insert, update, delete on public.opportunity_alerts from anon, authenticated;

-- Seed-/admin-managed reference data.
revoke insert, update, delete on public.provider_types from anon, authenticated;
revoke insert, update, delete on public.service_categories from anon, authenticated;
revoke insert, update, delete on public.services from anon, authenticated;
revoke insert, update, delete on public.credential_types from anon, authenticated;
revoke insert, update, delete on public.credential_requirements from anon, authenticated;
revoke insert, update, delete on public.geo_zips from anon, authenticated;
revoke insert, update, delete on public.geo_cities from anon, authenticated;

-- Future-only table: nothing for clients until reviews ship.
revoke insert, update, delete on public.reviews from anon, authenticated;

-- The migration tracking table is internal.
revoke all on public.manual_migrations from anon, authenticated;
