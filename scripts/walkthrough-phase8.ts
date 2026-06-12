import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { serviceDb, servicePool } from "../src/db/service";
import {
  locations,
  opportunities,
  opportunityOccurrences,
  organizationMembers,
  organizations,
  providerProfiles,
} from "../src/db/schema";
import { endRlsPool } from "../src/db/client";

/**
 * One-off Phase 8 walkthrough arrangement against whatever .env points at
 * (the hosted project). Creates two sign-in-able @example.com users — a
 * provider and a business owner with a posted opportunity — so the messaging
 * flow can be walked end-to-end in the preview browser. Re-runnable; clean
 * up with `--cleanup` (auth.users cascade removes everything).
 *
 * Run:    npx tsx --conditions=react-server --env-file=.env scripts/walkthrough-phase8.ts
 * Clean:  npx tsx --conditions=react-server --env-file=.env scripts/walkthrough-phase8.ts --cleanup
 */

const PROVIDER_EMAIL = "p8-provider@example.com";
const OWNER_EMAIL = "p8-owner@example.com";
const PASSWORD = "Phase8-walkthrough!1";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("missing Supabase env (url / service role key)");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (process.argv.includes("--cleanup")) {
    // Bookings carry RESTRICT FKs by design — sweep them before the cascade.
    await serviceDb.execute(sql`
      delete from completion_records where booking_id in
        (select id from bookings where organization_id in
          (select id from organizations where name = 'Phase 8 Walkthrough Spa'))
    `);
    await serviceDb.execute(sql`
      delete from bookings where organization_id in
        (select id from organizations where name = 'Phase 8 Walkthrough Spa')
    `);
    await serviceDb.execute(sql`
      delete from auth.users where email in (${PROVIDER_EMAIL}, ${OWNER_EMAIL})
    `);
    await serviceDb.execute(sql`delete from organizations where name = 'Phase 8 Walkthrough Spa'`);
    console.log("✓ cleaned up walkthrough users, bookings, and org");
    return;
  }

  async function ensureUser(email: string, fullName: string): Promise<string> {
    const existing = await serviceDb.execute<{ id: string }>(
      sql`select id from auth.users where email = ${email}`,
    );
    if (existing.rows.length) return existing.rows[0].id;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw error ?? new Error("createUser failed");
    return data.user.id;
  }

  const providerUserId = await ensureUser(PROVIDER_EMAIL, "Paula Provider");
  const ownerUserId = await ensureUser(OWNER_EMAIL, "Olivia Owner");

  const [provider] = await serviceDb
    .insert(providerProfiles)
    .values({
      userId: providerUserId,
      slug: `p8-paula-${providerUserId.slice(0, 8)}`,
      displayName: "Paula Provider, RN",
      homeState: "GA",
    })
    .onConflictDoNothing()
    .returning();

  const [org] = await serviceDb
    .insert(organizations)
    .values({
      name: "Phase 8 Walkthrough Spa",
      slug: `p8-spa-${ownerUserId.slice(0, 8)}`,
      createdByUserId: ownerUserId,
    })
    .returning();
  await serviceDb.insert(organizationMembers).values({
    organizationId: org.id,
    userId: ownerUserId,
    role: "owner",
    acceptedAt: new Date(),
  });
  const [location] = await serviceDb
    .insert(locations)
    .values({
      organizationId: org.id,
      name: "Midtown Studio",
      addressLine1: "999 Peachtree St NE",
      city: "Atlanta",
      state: "GA",
      zip: "30309",
      timezone: "America/New_York",
    })
    .returning();

  const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
  const [opp] = await serviceDb
    .insert(opportunities)
    .values({
      organizationId: org.id,
      locationId: location.id,
      postedByUserId: ownerUserId,
      type: "one_time_shift",
      title: "Injector coverage — Phase 8 walkthrough",
      description: "One-day coverage shift for the messaging walkthrough.",
      payKind: "fixed",
      payUnit: "hour",
      payMinCents: 9500,
      timezone: "America/New_York",
      status: "posted",
      postedAt: new Date(),
    })
    .returning();
  await serviceDb.insert(opportunityOccurrences).values({
    opportunityId: opp.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 8 * 3600_000),
  });

  console.log(`✓ provider  ${PROVIDER_EMAIL} / ${PASSWORD}  (profile ${provider?.id ?? "existing"})`);
  console.log(`✓ owner     ${OWNER_EMAIL} / ${PASSWORD}  (org ${org.id})`);
  console.log(`✓ opportunity ${opp.id} → http://localhost:4000/o/${opp.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await endRlsPool();
    await servicePool.end();
  });
