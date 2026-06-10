import { sql } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import {
  credentialTypes,
  locations,
  organizationMembers,
  organizations,
  opportunities,
  profiles,
  providerCredentials,
  providerProfiles,
} from "@/db/schema";

/**
 * Test fixtures created through the SERVICE role (RLS bypassed — that's the
 * point: fixtures are arranged freely, then assertions run through dbAs()).
 * Each fixture set is namespaced by a random suffix so test files can't
 * collide, and rls.test.ts tears down via auth.users cascade.
 */

export async function createUser(label: string, opts: { admin?: boolean } = {}) {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const result = await serviceDb.execute(sql`
    insert into auth.users (email, raw_user_meta_data)
    values (${email}, jsonb_build_object('full_name', ${label}::text))
    returning id
  `);
  const id = (result.rows[0] as { id: string }).id;
  if (opts.admin) {
    await serviceDb.update(profiles).set({ isPlatformAdmin: true }).where(sql`id = ${id}`);
  }
  return { id, email };
}

export async function createProvider(label: string) {
  const user = await createUser(label);
  const [profile] = await serviceDb
    .insert(providerProfiles)
    .values({
      userId: user.id,
      slug: `${label}-${user.id.slice(0, 8)}`,
      displayName: label,
      homeState: "GA",
    })
    .returning();
  return { user, profile };
}

export async function createOrg(label: string) {
  const owner = await createUser(`${label}-owner`);
  const [org] = await serviceDb
    .insert(organizations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`,
      createdByUserId: owner.id,
    })
    .returning();
  await serviceDb.insert(organizationMembers).values({
    organizationId: org.id,
    userId: owner.id,
    role: "owner",
    acceptedAt: new Date(),
  });
  const [location] = await serviceDb
    .insert(locations)
    .values({
      organizationId: org.id,
      name: "Test Location",
      addressLine1: "1 Test St",
      city: "Atlanta",
      state: "GA",
      zip: "30309",
      timezone: "America/New_York",
    })
    .returning();
  return { owner, org, location };
}

export async function addMember(orgId: string, role: "owner" | "admin" | "poster", label: string) {
  const user = await createUser(label);
  await serviceDb.insert(organizationMembers).values({
    organizationId: orgId,
    userId: user.id,
    role,
    acceptedAt: new Date(),
  });
  return user;
}

export async function createCredential(providerProfileId: string) {
  const [credType] = await serviceDb
    .select()
    .from(credentialTypes)
    .where(sql`slug = 'rn_license'`)
    .limit(1);
  if (!credType) throw new Error("run db:seed first — credential types missing");
  const [cred] = await serviceDb
    .insert(providerCredentials)
    .values({
      providerProfileId,
      credentialTypeId: credType.id,
      state: "GA",
      status: "self_attested",
      licenseNumber: "RN-TEST-1",
      selfAttestedAt: new Date(),
    })
    .returning();
  return cred;
}

export async function createPostedOpportunity(orgId: string, locationId: string, posterId: string) {
  const [opp] = await serviceDb
    .insert(opportunities)
    .values({
      organizationId: orgId,
      locationId,
      postedByUserId: posterId,
      type: "one_time_shift",
      title: "Test shift",
      payKind: "fixed",
      payUnit: "hour",
      payMinCents: 9000,
      timezone: "America/New_York",
      status: "posted",
      postedAt: new Date(),
    })
    .returning();
  return opp;
}
