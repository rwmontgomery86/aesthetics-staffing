-- HOSTED-ONLY (Supabase): org-media write policy. The bucket itself was
-- created in 0001_storage.sql (public read — logos and location photos are
-- public-facing, like the org row). Applied via the management API
-- (2026-06-11); kept here as the source of record.
--
-- Path convention: org-media/<organizationId>/<uuid>.<ext> — writes require
-- the admin role (or above) in that organization. The case expression keeps
-- a non-UUID first path segment from blowing up the ::uuid cast.

do $$ begin
  if not exists (select from pg_policies where schemaname='storage' and tablename='objects' and policyname='oc_org_media_admin_write') then
    create policy oc_org_media_admin_write on storage.objects for all to authenticated
      using (
        bucket_id = 'org-media'
        and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin')
          else false end
      )
      with check (
        bucket_id = 'org-media'
        and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin')
          else false end
      );
  end if;
end $$;
