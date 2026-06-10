-- HOSTED-ONLY (Supabase): storage buckets + owner-path RLS. The storage
-- schema does not exist on local/CI Postgres, so this is NOT part of the
-- db:migrate chain — it is applied to the Supabase project via the
-- management API (applied 2026-06-10) and kept here as the source of record.
--
-- Access model:
--   - Owners read/write ONLY their own folder (path prefix = auth.uid()).
--   - Businesses-with-grant and admin review NEVER go through storage
--     policies: the server checks profile_access_grants / is_platform_admin,
--     issues a 5-minute signed URL, and writes document_access_logs
--     (Phases 7 and 9).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('credentials', 'credentials', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('portfolios',  'portfolios',  false, 8388608, array['image/jpeg','image/png','image/webp']),
  ('avatars',     'avatars',     true,  4194304, array['image/jpeg','image/png','image/webp']),
  ('org-media',   'org-media',   true,  8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select from pg_policies where schemaname='storage' and tablename='objects' and policyname='oc_credentials_owner') then
    create policy oc_credentials_owner on storage.objects for all to authenticated
      using (bucket_id = 'credentials' and (storage.foldername(name))[1] = (select auth.uid()::text))
      with check (bucket_id = 'credentials' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
  if not exists (select from pg_policies where schemaname='storage' and tablename='objects' and policyname='oc_portfolios_owner') then
    create policy oc_portfolios_owner on storage.objects for all to authenticated
      using (bucket_id = 'portfolios' and (storage.foldername(name))[1] = (select auth.uid()::text))
      with check (bucket_id = 'portfolios' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
  if not exists (select from pg_policies where schemaname='storage' and tablename='objects' and policyname='oc_avatars_owner_write') then
    create policy oc_avatars_owner_write on storage.objects for all to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
end $$;
