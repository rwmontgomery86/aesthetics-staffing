import { sql, eq } from "drizzle-orm";
import { serviceDb, servicePool } from "../service";
import {
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  organizationMembers,
  organizations,
  profiles,
  providerCredentials,
  providerProfiles,
  providerProfileTypes,
  providerServices,
  providerTypes,
  credentialTypes,
  services,
  watchZones,
} from "../schema";

/**
 * LOCAL/CI DEMO DATA ONLY. Inserts directly into the auth.users shim — on a
 * real Supabase project users come from Supabase Auth, so this guard refuses
 * to run against anything that doesn't look like a local database.
 */

const dbUrl = process.env.DATABASE_URL_SERVICE ?? "";
if (!/localhost|127\.0\.0\.1|@postgres[:/]/.test(dbUrl) && !process.env.ALLOW_DEMO_SEED) {
  console.error("demo seed refused: DATABASE_URL_SERVICE does not look local (set ALLOW_DEMO_SEED=1 to override)");
  process.exit(1);
}

async function upsertAuthUser(email: string, fullName: string): Promise<string> {
  const rows = await serviceDb.execute(sql`
    insert into auth.users (email, raw_user_meta_data)
    values (${email}, jsonb_build_object('full_name', ${fullName}::text))
    on conflict (email) do update set email = excluded.email
    returning id
  `);
  return (rows.rows[0] as { id: string }).id;
}

async function main() {
  // ── Users (profiles auto-created by the on_auth_user_created trigger) ────
  const providerUserId = await upsertAuthUser("provider@demo.test", "Maya Chen");
  const ownerUserId = await upsertAuthUser("owner@demo.test", "Jordan Wells");
  const adminUserId = await upsertAuthUser("admin@demo.test", "Platform Admin");

  await serviceDb.update(profiles).set({ isPlatformAdmin: true }).where(eq(profiles.id, adminUserId));
  await serviceDb
    .update(profiles)
    .set({ phoneE164: "+14045550100", smsOptedIn: true })
    .where(eq(profiles.id, providerUserId));

  // ── Provider: RN injector in Atlanta ──────────────────────────────────────
  const [providerProfile] = await serviceDb
    .insert(providerProfiles)
    .values({
      userId: providerUserId,
      slug: `maya-chen-${providerUserId.slice(0, 8)}`,
      displayName: "Maya Chen, RN",
      bio: "Aesthetic nurse injector — neurotoxin and dermal filler.",
      homeCity: "Atlanta",
      homeState: "GA",
      homeZip: "30309",
      travelRadiusM: 40_000,
      yearsExperience: 6,
      payMinCents: 8_500,
      payMinUnit: "hour",
      payStructuresAccepted: ["hour", "day", "per_treatment"],
      urgentAvailable: true,
      onboardingStatus: "complete",
    })
    .onConflictDoUpdate({ target: providerProfiles.userId, set: { displayName: "Maya Chen, RN" } })
    .returning();

  const allTypes = await serviceDb.select().from(providerTypes);
  const allServices = await serviceDb.select().from(services);
  const allCredTypes = await serviceDb.select().from(credentialTypes);
  const injectorRn = allTypes.find((t) => t.slug === "injector_rn")!;
  const neurotoxin = allServices.find((s) => s.slug === "neurotoxin")!;
  const filler = allServices.find((s) => s.slug === "dermal_filler")!;
  const rnLicense = allCredTypes.find((c) => c.slug === "rn_license")!;

  await serviceDb
    .insert(providerProfileTypes)
    .values({ providerProfileId: providerProfile.id, providerTypeId: injectorRn.id, isPrimary: true })
    .onConflictDoNothing();
  await serviceDb
    .insert(providerServices)
    .values([
      { providerProfileId: providerProfile.id, serviceId: neurotoxin.id, yearsExperience: 6 },
      { providerProfileId: providerProfile.id, serviceId: filler.id, yearsExperience: 4 },
    ])
    .onConflictDoNothing();

  await serviceDb
    .insert(providerCredentials)
    .values({
      providerProfileId: providerProfile.id,
      credentialTypeId: rnLicense.id,
      state: "GA",
      status: "self_attested",
      licenseNumber: "RN-DEMO-123456",
      issuingBoard: "Georgia Board of Nursing",
      expiresAt: "2027-01-31",
      selfAttestedAt: new Date(),
    })
    .onConflictDoNothing();

  // Watch zone: 40 km radius around Midtown Atlanta, materialized via ST_Buffer.
  const existingZones = await serviceDb
    .select()
    .from(watchZones)
    .where(eq(watchZones.providerProfileId, providerProfile.id));
  if (existingZones.length === 0) {
    await serviceDb.execute(sql`
      insert into watch_zones
        (provider_profile_id, name, kind, geom, geometry_meta, service_ids, min_pay_cents, channel_sms)
      values (
        ${providerProfile.id},
        'Metro Atlanta',
        'radius',
        st_buffer(st_setsrid(st_makepoint(-84.3880, 33.7490), 4326)::geography, 40000),
        ${JSON.stringify({ kind: "radius", centerLat: 33.749, centerLng: -84.388, radiusMeters: 40000 })}::jsonb,
        ${sql.raw(`'{"${neurotoxin.id}","${filler.id}"}'::uuid[]`)},
        8000,
        true
      )
    `);
  }

  // ── Business: med spa org + Buckhead location ─────────────────────────────
  const [org] = await serviceDb
    .insert(organizations)
    .values({
      name: "Peachtree Aesthetics (Demo)",
      slug: "peachtree-aesthetics-demo",
      kind: "med_spa",
      description: "Demo med spa in Buckhead.",
      createdByUserId: ownerUserId,
    })
    .onConflictDoUpdate({ target: organizations.slug, set: { name: "Peachtree Aesthetics (Demo)" } })
    .returning();

  await serviceDb
    .insert(organizationMembers)
    .values({ organizationId: org.id, userId: ownerUserId, role: "owner", acceptedAt: new Date() })
    .onConflictDoNothing();

  const existingLocations = await serviceDb
    .select()
    .from(locations)
    .where(eq(locations.organizationId, org.id));
  let locationId: string;
  if (existingLocations.length > 0) {
    locationId = existingLocations[0].id;
  } else {
    const inserted = await serviceDb.execute(sql`
      insert into locations
        (organization_id, name, address_line1, city, state, zip, geog, timezone, supervision_context)
      values (
        ${org.id}, 'Buckhead', '3340 Peachtree Rd NE', 'Atlanta', 'GA', '30326',
        st_setsrid(st_makepoint(-84.3623, 33.8463), 4326)::geography,
        'America/New_York',
        'Medical director on-site Tuesdays; available by phone otherwise. (Demo text.)'
      )
      returning id
    `);
    locationId = (inserted.rows[0] as { id: string }).id;
  }

  // ── A posted one-time shift next week (occurrence included) ───────────────
  const existingOpps = await serviceDb
    .select()
    .from(opportunities)
    .where(eq(opportunities.organizationId, org.id));
  if (existingOpps.length === 0) {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 7);
    startsAt.setHours(10, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(16, 0, 0, 0);

    const [opp] = await serviceDb
      .insert(opportunities)
      .values({
        organizationId: org.id,
        locationId,
        postedByUserId: ownerUserId,
        type: "one_time_shift",
        title: "Injector coverage — Saturday botox event",
        description: "Coverage for a busy Saturday. Established patients, full support staff.",
        payKind: "range",
        payUnit: "hour",
        payMinCents: 9_000,
        payMaxCents: 11_000,
        timezone: "America/New_York",
        urgent: false,
        supervisionAttestedAt: new Date(),
        status: "posted",
        postedAt: new Date(),
      })
      .returning();

    await serviceDb.insert(opportunityOccurrences).values({
      opportunityId: opp.id,
      startsAt,
      endsAt,
    });
    await serviceDb.insert(opportunityServices).values([
      { opportunityId: opp.id, serviceId: neurotoxin.id },
      { opportunityId: opp.id, serviceId: filler.id },
    ]);
    await serviceDb.insert(opportunityProviderTypes).values([
      { opportunityId: opp.id, providerTypeId: injectorRn.id },
    ]);
  }

  console.log("✓ demo data: provider@demo.test, owner@demo.test, admin@demo.test");
  await servicePool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
