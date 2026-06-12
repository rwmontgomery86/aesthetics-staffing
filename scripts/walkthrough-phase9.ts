import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { serviceDb, servicePool } from "../src/db/service";
import {
  credentialDocuments,
  credentialTypes,
  locations,
  messages,
  opportunities,
  opportunityOccurrences,
  organizationMembers,
  organizations,
  providerCredentials,
  providerProfiles,
} from "../src/db/schema";
import { ensureParticipant, getOrCreateThread } from "../src/lib/messaging/threads";
import { endRlsPool } from "../src/db/client";

/**
 * Phase 9 walkthrough arrangement against whatever .env points at (hosted):
 * sign-in-able @example.com users + the data the admin dashboard reads — a
 * credential awaiting review WITH a real document in storage, one expiring
 * soon, a posted opportunity, and a contact-flagged message thread.
 *
 * The p9-admin user is created WITHOUT the platform-admin flag — flipping
 * that is a separate, deliberate step.
 *
 * Run:    npx tsx --conditions=react-server --env-file=.env scripts/walkthrough-phase9.ts
 * Clean:  npx tsx --conditions=react-server --env-file=.env scripts/walkthrough-phase9.ts --cleanup
 */

const EMAILS = {
  provider: "p9-provider@example.com",
  owner: "p9-owner@example.com",
  admin: "p9-admin@example.com",
};
const PASSWORD = "Phase9-walkthrough!1";
const ORG_NAME = "Phase 9 Walkthrough Clinic";

const TINY_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \n" +
    "trailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n",
);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("missing Supabase env (url / service role key)");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (process.argv.includes("--cleanup")) {
    const docs = await serviceDb.execute<{ storage_path: string }>(sql`
      select cd.storage_path from credential_documents cd
      join provider_credentials pc on pc.id = cd.provider_credential_id
      join provider_profiles pp on pp.id = pc.provider_profile_id
      join auth.users u on u.id = pp.user_id
      where u.email = ${EMAILS.provider}
    `);
    if (docs.rows.length > 0) {
      await admin.storage.from("credentials").remove(docs.rows.map((d) => d.storage_path));
    }
    await serviceDb.execute(sql`
      delete from completion_records where booking_id in
        (select id from bookings where organization_id in
          (select id from organizations where name = ${ORG_NAME}))
    `);
    await serviceDb.execute(sql`
      delete from bookings where organization_id in
        (select id from organizations where name = ${ORG_NAME})
    `);
    await serviceDb.execute(sql`
      delete from auth.users where email in (${EMAILS.provider}, ${EMAILS.owner}, ${EMAILS.admin})
    `);
    await serviceDb.execute(sql`delete from organizations where name = ${ORG_NAME}`);
    console.log("✓ cleaned up walkthrough users, documents, and org");
    return;
  }

  /**
   * Sign-in always happens against HOSTED Supabase Auth; the connected
   * database (hosted normally, LOCAL when .env.local points the app at
   * Postgres.app for an admin-UI walkthrough) gets a mirrored auth.users row
   * with the SAME id so the JWT's sub resolves to a profile.
   */
  async function ensureUser(email: string, fullName: string): Promise<string> {
    let id: string | undefined;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (data.user) id = data.user.id;
    if (!id) {
      // Already registered in hosted auth — find the id via the admin API.
      const { data: list, error: listError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) throw listError;
      id = list.users.find((u) => u.email === email)?.id;
      if (!id) throw error ?? new Error(`user ${email} unresolvable`);
    }
    await serviceDb.execute(sql`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${email}, jsonb_build_object('full_name', ${fullName}::text))
      on conflict (id) do nothing
    `);
    return id;
  }

  const providerUserId = await ensureUser(EMAILS.provider, "Penny Provider");
  const ownerUserId = await ensureUser(EMAILS.owner, "Oscar Owner");
  const adminUserId = await ensureUser(EMAILS.admin, "Ada Admin");

  const [provider] = await serviceDb
    .insert(providerProfiles)
    .values({
      userId: providerUserId,
      slug: `p9-penny-${providerUserId.slice(0, 8)}`,
      displayName: "Penny Provider, RN",
      homeState: "GA",
    })
    .returning();

  // Two credential types: one awaiting review (with a real document in the
  // private bucket), one expiring inside the 30-day window.
  const types = await serviceDb.select().from(credentialTypes).limit(2);
  if (types.length < 2) throw new Error("credential types not seeded on this database");
  const storagePath = `${providerUserId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await admin.storage
    .from("credentials")
    .upload(storagePath, TINY_PDF, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const [reviewable] = await serviceDb
    .insert(providerCredentials)
    .values({
      providerProfileId: provider.id,
      credentialTypeId: types[0].id,
      state: "GA",
      status: "document_uploaded",
      licenseNumber: "RN-P9-0001",
      issuingBoard: "Georgia Board of Nursing",
      expiresAt: "2027-06-30",
      selfAttestedAt: new Date(),
      submittedForReviewAt: new Date(),
    })
    .returning();
  await serviceDb.insert(credentialDocuments).values({
    providerCredentialId: reviewable.id,
    storagePath,
    fileName: "rn-license.pdf",
    mimeType: "application/pdf",
    sizeBytes: TINY_PDF.length,
  });
  const expiresSoon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  await serviceDb.insert(providerCredentials).values({
    providerProfileId: provider.id,
    credentialTypeId: types[1].id,
    state: "GA",
    status: "self_attested",
    selfAttestedAt: new Date(),
    expiresAt: expiresSoon,
  });

  const [org] = await serviceDb
    .insert(organizations)
    .values({
      name: ORG_NAME,
      slug: `p9-clinic-${ownerUserId.slice(0, 8)}`,
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
      name: "Buckhead Suite",
      addressLine1: "55 Lenox Rd NE",
      city: "Atlanta",
      state: "GA",
      zip: "30326",
      timezone: "America/New_York",
    })
    .returning();
  const startsAt = new Date(Date.now() + 5 * 86400_000);
  const [opp] = await serviceDb
    .insert(opportunities)
    .values({
      organizationId: org.id,
      locationId: location.id,
      postedByUserId: ownerUserId,
      type: "one_time_shift",
      title: "Laser tech coverage — Phase 9 walkthrough",
      payKind: "fixed",
      payUnit: "hour",
      payMinCents: 8800,
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

  // A contact-flagged message for the Reports queue.
  const thread = (await getOrCreateThread(serviceDb, {
    opportunityId: opp.id,
    organizationId: org.id,
    providerProfileId: provider.id,
  }))!;
  await ensureParticipant(serviceDb, thread.id, providerUserId);
  await serviceDb.insert(messages).values({
    threadId: thread.id,
    senderUserId: providerUserId,
    body: "Faster to text me at 404-555-0188 honestly",
    contactFlagged: true,
  });

  console.log(`✓ provider  ${EMAILS.provider} / ${PASSWORD}`);
  console.log(`✓ owner     ${EMAILS.owner} / ${PASSWORD}`);
  console.log(`✓ admin     ${EMAILS.admin} / ${PASSWORD}  (id ${adminUserId} — NOT yet platform admin)`);
  console.log(`✓ credential awaiting review: ${reviewable.id} (doc at ${storagePath})`);
  console.log(`✓ opportunity ${opp.id} · thread ${thread.id}`);
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
