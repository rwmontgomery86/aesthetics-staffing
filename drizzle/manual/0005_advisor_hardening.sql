-- Hardening from the Supabase security advisor (2026-06-10). Context: the
-- PostgREST Data API is not part of our architecture (all access goes through
-- dbAs()/service pools), but these reduce surface if it's ever enabled.

-- Trigger functions get EXECUTE for PUBLIC by default — nobody should call
-- them directly. (Triggers themselves still fire; they don't need caller
-- execute rights.)
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.protect_credential_review_columns() from public, anon, authenticated;

-- The append-only log writers are SECURITY DEFINER: an anonymous caller could
-- spam audit rows through RPC. Signed-in users keep access (it's their write
-- path and rows carry their auth.uid()).
revoke execute on function
  public.record_audit(text, text, text, uuid, uuid, jsonb, text, text),
  public.record_document_access(uuid, text, uuid, text, uuid)
from public, anon;

-- PostGIS's coordinate-system catalog can't have RLS (extension-owned) and
-- holds no user data; remove client read access anyway.
do $$ begin
  revoke all on table public.spatial_ref_sys from anon, authenticated;
exception when others then
  raise notice 'spatial_ref_sys revoke skipped: %', sqlerrm;
end $$;
