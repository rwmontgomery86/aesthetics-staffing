import { eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "../src/db/client";
import { serviceDb, servicePool } from "../src/db/service";
import {
  organizationMembers,
  organizations,
  profiles,
  providerProfiles,
} from "../src/db/schema";

/**
 * Post-deploy smoke test against whatever database .env points at.
 * Expects an auth user smoketest@example.com to exist (create via the signup
 * API or UI first). Verifies: signup trigger created the profile, and both
 * hats (provider + business) can be created and read back through the
 * RLS-enforced dbAs() path. Cleans up after itself.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env scripts/smoke-hosted.ts
 */

async function main() {
  const rows = await serviceDb.execute(
    sql`select id from auth.users where email = 'smoketest@example.com'`,
  );
  if (!rows.rows.length) {
    console.error("✗ create smoketest@example.com via the signup API first");
    process.exit(1);
  }
  const userId = (rows.rows[0] as { id: string }).id;

  const [profile] = await serviceDb.select().from(profiles).where(eq(profiles.id, userId));
  console.log("trigger-created profile:", profile ? `✓ "${profile.fullName}"` : "✗ MISSING");

  await dbAs(userId, (tx) =>
    tx.insert(providerProfiles).values({
      userId,
      slug: `smoke-${userId.slice(0, 8)}`,
      displayName: "Smoke Test, RN",
      homeState: "GA",
    }),
  );

  await dbAs(userId, async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Smoke Spa", slug: `smoke-spa-${userId.slice(0, 8)}`, createdByUserId: userId })
      .returning({ id: organizations.id });
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });
  });

  const hats = await dbAs(userId, async (tx) => ({
    provider: await tx.select().from(providerProfiles).where(eq(providerProfiles.userId, userId)),
    orgs: await tx.select().from(organizationMembers).where(eq(organizationMembers.userId, userId)),
  }));
  console.log("provider hat via RLS:", hats.provider.length === 1 ? "✓" : "✗");
  console.log("business hat via RLS:", hats.orgs.length === 1 ? "✓ (owner)" : "✗");

  await serviceDb.execute(sql`delete from organizations where slug like 'smoke-spa-%'`);
  await serviceDb.execute(sql`delete from auth.users where email = 'smoketest@example.com'`);
  console.log("cleanup ✓");

  await endRlsPool();
  await servicePool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
