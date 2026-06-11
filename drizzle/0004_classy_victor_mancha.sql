ALTER POLICY "opportunities_select" ON "opportunities" TO anon,authenticated USING ("opportunities"."status" = 'posted'
        or (select public.is_org_member("opportunities"."organization_id"))
        or (select public.provider_has_applied("opportunities"."id"))
        or (select public.is_platform_admin()));