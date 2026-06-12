import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  notificationDeliveries,
  notifications,
  opportunities,
  organizationAdminNotes,
  profiles,
  providerCredentials,
} from "@/db/schema";
import { notifyEventJob } from "@/workers/jobs/events";
import { stopBoss } from "@/lib/queue";
import {
  cleanupBookings,
  createCredential,
  createOrg,
  createPostedOpportunity,
  createProvider,
  createUser,
} from "./helpers/fixtures";

/**
 * Phase 9 proofs (exit criteria): non-admins blocked by RLS everywhere the
 * dashboard reads/writes; review decisions are admin-only at the database
 * level and round-trip to a provider notification; admin mutations and
 * document views land in the audit / access logs.
 */

afterAll(async () => {
  await cleanupBookings();
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await stopBoss();
  await endRlsPool();
  await servicePool.end();
});

describe("non-admin RLS blocks", () => {
  it("audit logs are admin-only", async () => {
    const admin = await createUser("aud-admin", { admin: true });
    const civilian = await createUser("aud-user");
    await dbAs(admin.id, (tx) =>
      tx.execute(sql`select public.record_audit('admin', 'test.entry', 'profile', ${admin.id}::uuid)`),
    );

    const adminView = await dbAs(admin.id, (tx) =>
      tx.execute<{ id: number }>(sql`select id from audit_logs where action = 'test.entry'`),
    );
    expect(adminView.rows.length).toBeGreaterThan(0);
    const civilianView = await dbAs(civilian.id, (tx) =>
      tx.execute<{ id: number }>(sql`select id from audit_logs where action = 'test.entry'`),
    );
    expect(civilianView.rows).toHaveLength(0);
  });

  it("org admin notes are invisible to the org's own owner", async () => {
    const { owner, org } = await createOrg("rlstest-notes");
    const admin = await createUser("notes-admin", { admin: true });
    await dbAs(admin.id, (tx) =>
      tx
        .insert(organizationAdminNotes)
        .values({ organizationId: org.id, notes: "watch this one" }),
    );

    const ownerView = await dbAs(owner.id, (tx) =>
      tx.select().from(organizationAdminNotes).where(eq(organizationAdminNotes.organizationId, org.id)),
    );
    expect(ownerView).toHaveLength(0);
    await expect(
      dbAs(owner.id, (tx) =>
        tx
          .insert(organizationAdminNotes)
          .values({ organizationId: org.id, notes: "self-serve" })
          .onConflictDoUpdate({
            target: organizationAdminNotes.organizationId,
            set: { notes: "self-serve" },
          }),
      ),
    ).rejects.toThrow();
  });

  it("only admins can set review decisions (trigger) and suspend users (RLS)", async () => {
    const { user, profile } = await createProvider("rev-owner");
    const credential = await createCredential(profile.id);

    // The owner may edit their credential, but not crown it reviewed.
    await expect(
      dbAs(user.id, (tx) =>
        tx
          .update(providerCredentials)
          .set({ status: "admin_reviewed" })
          .where(eq(providerCredentials.id, credential.id)),
      ),
    ).rejects.toThrow(/only platform admins/);

    // A non-admin updating someone else's profile matches zero rows.
    const civilian = await createUser("susp-civilian");
    await dbAs(civilian.id, (tx) =>
      tx
        .update(profiles)
        .set({ suspendedAt: new Date(), suspendedReason: "nope" })
        .where(eq(profiles.id, user.id)),
    );
    const [untouched] = await serviceDb.select().from(profiles).where(eq(profiles.id, user.id));
    expect(untouched.suspendedAt).toBeNull();

    // An admin suspends with reason, audited — the dashboard's exact writes.
    const admin = await createUser("susp-admin", { admin: true });
    await dbAs(admin.id, async (tx) => {
      await tx
        .update(profiles)
        .set({ suspendedAt: new Date(), suspendedReason: "test suspension" })
        .where(eq(profiles.id, user.id));
      await tx.execute(sql`
        select public.record_audit('admin', 'user.suspended', 'profile', ${user.id}::uuid, null,
          '{"reason":"test suspension"}'::jsonb)
      `);
    });
    const [suspended] = await serviceDb.select().from(profiles).where(eq(profiles.id, user.id));
    expect(suspended.suspendedAt).not.toBeNull();
    const audit = await serviceDb.execute<{ actor_user_id: string }>(sql`
      select actor_user_id from audit_logs
      where action = 'user.suspended' and entity_id = ${user.id}
    `);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_user_id).toBe(admin.id);
  });

  it("notifications: admin arm reads others' rows, civilians cannot", async () => {
    const target = await createUser("notif-target");
    await serviceDb.insert(notifications).values({
      userId: target.id,
      kind: "test_kind",
      title: "t",
      body: "b",
    });
    const admin = await createUser("notif-admin", { admin: true });
    const civilian = await createUser("notif-civilian");

    const adminRows = await dbAs(admin.id, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, target.id)),
    );
    expect(adminRows).toHaveLength(1);
    const civilianRows = await dbAs(civilian.id, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, target.id)),
    );
    expect(civilianRows).toHaveLength(0);
  });

  it("admin_user_email is hard-gated on the admin flag", async () => {
    const target = await createUser("email-target");
    const admin = await createUser("email-admin", { admin: true });
    const civilian = await createUser("email-civilian");

    const forAdmin = await dbAs(admin.id, (tx) =>
      tx.execute<{ email: string | null }>(
        sql`select public.admin_user_email(${target.id}::uuid) as email`,
      ),
    );
    expect(forAdmin.rows[0].email).toBe(target.email);
    const forCivilian = await dbAs(civilian.id, (tx) =>
      tx.execute<{ email: string | null }>(
        sql`select public.admin_user_email(${target.id}::uuid) as email`,
      ),
    );
    expect(forCivilian.rows[0].email).toBeNull();
  });
});

describe("credential review round-trip", () => {
  it("admin decision lands, is audited, and notifies the provider", async () => {
    const { user, profile } = await createProvider("rt-prov");
    const credential = await createCredential(profile.id);
    const admin = await createUser("rt-admin", { admin: true });

    // What reviewCredentialAction does at the DB level, as the admin user.
    await dbAs(admin.id, async (tx) => {
      await tx
        .update(providerCredentials)
        .set({
          status: "admin_reviewed",
          reviewedByUserId: admin.id,
          reviewedAt: new Date(),
        })
        .where(eq(providerCredentials.id, credential.id));
      await tx.execute(sql`
        select public.record_audit('admin', 'credential.reviewed', 'provider_credential',
          ${credential.id}::uuid)
      `);
    });

    const [updated] = await serviceDb
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, credential.id));
    expect(updated.status).toBe("admin_reviewed");

    // Worker round-trip, idempotent on retries.
    for (let i = 0; i < 2; i++) {
      await notifyEventJob({ kind: "credential_reviewed", credentialId: credential.id });
    }
    const rows = await serviceDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.kind, "credential_reviewed")),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("verified");
    const deliveries = await serviceDb
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, rows[0].id));
    expect(deliveries.map((d) => d.channel)).toEqual(["email"]);

    // A re-review after re-submission notifies again (status in the key).
    await serviceDb
      .update(providerCredentials)
      .set({ status: "rejected_needs_info", rejectionReason: "blurry scan" })
      .where(eq(providerCredentials.id, credential.id));
    await notifyEventJob({ kind: "credential_reviewed", credentialId: credential.id });
    const after = await serviceDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.kind, "credential_reviewed")),
      );
    expect(after).toHaveLength(2);
    expect(after.some((n) => n.body.includes("blurry scan"))).toBe(true);
  });
});

describe("post removal", () => {
  it("admin archives a post (RLS-allowed), audited, poster notified; civilians blocked", async () => {
    const { owner, org, location } = await createOrg("rlstest-remove");
    const opp = await createPostedOpportunity(org.id, location.id, owner.id);
    const stranger = await createProvider("remove-stranger");
    const admin = await createUser("remove-admin", { admin: true });

    // A stranger's update matches zero rows.
    await dbAs(stranger.user.id, (tx) =>
      tx.update(opportunities).set({ status: "archived" }).where(eq(opportunities.id, opp.id)),
    );
    let [row] = await serviceDb.select().from(opportunities).where(eq(opportunities.id, opp.id));
    expect(row.status).toBe("posted");

    await dbAs(admin.id, async (tx) => {
      await tx
        .update(opportunities)
        .set({ status: "archived" })
        .where(eq(opportunities.id, opp.id));
      await tx.execute(sql`
        select public.record_audit('admin', 'post.removed', 'opportunity',
          ${opp.id}::uuid, ${org.id}::uuid)
      `);
    });
    [row] = await serviceDb.select().from(opportunities).where(eq(opportunities.id, opp.id));
    expect(row.status).toBe("archived");

    await notifyEventJob({ kind: "post_removed", opportunityId: opp.id, reason: "test cleanup" });
    const notes = await serviceDb
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.kind, "post_removed")));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("test cleanup");
  });
});

describe("document access logging", () => {
  it("admin views write an admin_view row the provider can see", async () => {
    const { user, profile } = await createProvider("doc-prov");
    const credential = await createCredential(profile.id);
    const admin = await createUser("doc-admin", { admin: true });

    // What /api/files/sign records when an admin (no grant, not owner) views.
    await dbAs(admin.id, (tx) =>
      tx.execute(sql`
        select public.record_document_access(
          ${profile.id}::uuid, 'credential', ${credential.id}::uuid, 'admin_view', null::uuid)
      `),
    );

    const providerView = await dbAs(user.id, (tx) =>
      tx.execute<{ access_kind: string; accessor_user_id: string }>(sql`
        select access_kind, accessor_user_id from document_access_logs
        where provider_profile_id = ${profile.id}
      `),
    );
    expect(providerView.rows).toHaveLength(1);
    expect(providerView.rows[0].access_kind).toBe("admin_view");
    expect(providerView.rows[0].accessor_user_id).toBe(admin.id);
  });
});
