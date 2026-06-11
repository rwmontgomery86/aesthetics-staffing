ALTER TABLE "applications" ADD COLUMN "credential_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER POLICY "profiles_select" ON "profiles" TO authenticated USING ("profiles"."id" = (select auth.uid()) or (select public.is_platform_admin()) or exists (
        select 1 from organization_members m1
        join organization_members m2 on m2.organization_id = m1.organization_id
        where m1.user_id = (select auth.uid()) and m2.user_id = "profiles"."id"
      ) or (select public.org_has_confirmed_booking_with("profiles"."id")));--> statement-breakpoint
ALTER POLICY "bookings_insert" ON "bookings" TO authenticated WITH CHECK (exists (select 1 from opportunities o
          where o.id = "bookings"."opportunity_id"
            and o.organization_id = "bookings"."organization_id"
            and o.location_id = "bookings"."location_id")
        and ((select public.has_org_role("bookings"."organization_id", 'poster'))
          or ("bookings"."provider_profile_id" = (select public.my_provider_profile_id())
              and exists (select 1 from applications a
                    where a.id = "bookings"."application_id"
                      and a.provider_profile_id = "bookings"."provider_profile_id"
                      and a.opportunity_id = "bookings"."opportunity_id"
                      and a.status in ('offered', 'accepted')))));