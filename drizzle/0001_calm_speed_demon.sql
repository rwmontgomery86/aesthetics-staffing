ALTER POLICY "org_members_insert" ON "organization_members" TO authenticated WITH CHECK (
        (select public.has_org_role("organization_members"."organization_id", 'admin'))
        or (
          "organization_members"."user_id" = (select auth.uid()) and "organization_members"."role" = 'owner'
          and exists (
            select 1 from organizations o
            where o.id = "organization_members"."organization_id" and o.created_by_user_id = (select auth.uid())
          )
          and not (select public.org_has_any_member("organization_members"."organization_id"))
        )
        or (
          "organization_members"."user_id" = (select auth.uid())
          and exists (
            select 1 from organization_invites i
            where i.organization_id = "organization_members"."organization_id"
              and lower(i.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
              and i.expires_at > now()
              and i.accepted_by_user_id is null
          )
        ));