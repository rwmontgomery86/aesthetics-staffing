import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { dbAs, dbAsAnon, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  applications,
  auditLogs,
  messages,
  notifications,
  opportunities,
  organizationMembers,
  organizations,
  profiles,
  profileAccessGrants,
  providerCredentials,
  reviews,
  threadParticipants,
  threads,
  watchZones,
} from "@/db/schema";
import {
  addMember,
  createCredential,
  createOrg,
  createPostedOpportunity,
  createProvider,
  createUser,
} from "./helpers/fixtures";

/**
 * Proves the RLS policy matrix from docs/DATABASE_SCHEMA.md §10 against a
 * migrated + seeded database, through the same dbAs() path the app will use.
 * Requires: npm run db:migrate && npm run db:seed.
 */

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await endRlsPool();
  await servicePool.end();
});

describe("fail-closed foundation", () => {
  it("rls_client without claim injection has no access at all", async () => {
    const raw = new pg.Client({ connectionString: process.env.DATABASE_URL_RLS });
    await raw.connect();
    try {
      await expect(raw.query("select * from profiles limit 1")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await raw.end();
    }
  });

  it("dbAs round-trips a policy-gated query (own profile visible)", async () => {
    const user = await createUser("roundtrip");
    const rows = await dbAs(user.id, (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, user.id)),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("provider credentials (the most sensitive table)", () => {
  it("a provider cannot read another provider's credentials", async () => {
    const a = await createProvider("rlstest-prov-a");
    const b = await createProvider("rlstest-prov-b");
    await createCredential(a.profile.id);

    const seenByA = await dbAs(a.user.id, (tx) => tx.select().from(providerCredentials));
    const seenByB = await dbAs(b.user.id, (tx) => tx.select().from(providerCredentials));
    expect(seenByA.some((c) => c.providerProfileId === a.profile.id)).toBe(true);
    expect(seenByB.some((c) => c.providerProfileId === a.profile.id)).toBe(false);
  });

  it("org members see credentials ONLY through an unrevoked grant", async () => {
    const prov = await createProvider("rlstest-prov-grant");
    await createCredential(prov.profile.id);
    const { owner, org } = await createOrg("rlstest-org-grant");

    const before = await dbAs(owner.id, (tx) => tx.select().from(providerCredentials));
    expect(before.some((c) => c.providerProfileId === prov.profile.id)).toBe(false);

    const [grant] = await serviceDb
      .insert(profileAccessGrants)
      .values({ providerProfileId: prov.profile.id, organizationId: org.id, grantedVia: "manual" })
      .returning();

    const during = await dbAs(owner.id, (tx) => tx.select().from(providerCredentials));
    expect(during.some((c) => c.providerProfileId === prov.profile.id)).toBe(true);

    await serviceDb
      .update(profileAccessGrants)
      .set({ revokedAt: new Date() })
      .where(eq(profileAccessGrants.id, grant.id));

    const after = await dbAs(owner.id, (tx) => tx.select().from(providerCredentials));
    expect(after.some((c) => c.providerProfileId === prov.profile.id)).toBe(false);
  });

  it("a provider cannot self-approve (trigger blocks review decisions)", async () => {
    const prov = await createProvider("rlstest-prov-selfapprove");
    const cred = await createCredential(prov.profile.id);
    await expect(
      dbAs(prov.user.id, (tx) =>
        tx
          .update(providerCredentials)
          .set({ status: "admin_reviewed" })
          .where(eq(providerCredentials.id, cred.id)),
      ),
    ).rejects.toThrow(/only platform admins/);
  });

  it("a platform admin can set review decisions", async () => {
    const prov = await createProvider("rlstest-prov-adminreview");
    const cred = await createCredential(prov.profile.id);
    const admin = await createUser("rlstest-admin-review", { admin: true });
    await dbAs(admin.id, (tx) =>
      tx
        .update(providerCredentials)
        .set({ status: "admin_reviewed", reviewedByUserId: admin.id, reviewedAt: new Date() })
        .where(eq(providerCredentials.id, cred.id)),
    );
    const [updated] = await serviceDb
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, cred.id));
    expect(updated.status).toBe("admin_reviewed");
  });
});

describe("applications", () => {
  it("visible to the applicant and the opportunity's org — not to other orgs", async () => {
    const prov = await createProvider("rlstest-prov-app");
    const { owner, org, location } = await createOrg("rlstest-org-app");
    const otherOrg = await createOrg("rlstest-org-other");
    const opp = await createPostedOpportunity(org.id, location.id, owner.id);

    await dbAs(prov.user.id, (tx) =>
      tx.insert(applications).values({
        opportunityId: opp.id,
        providerProfileId: prov.profile.id,
        scope: "series",
      }),
    );

    const byProvider = await dbAs(prov.user.id, (tx) => tx.select().from(applications));
    const byOrgOwner = await dbAs(owner.id, (tx) => tx.select().from(applications));
    const byOtherOrg = await dbAs(otherOrg.owner.id, (tx) => tx.select().from(applications));
    expect(byProvider.some((a) => a.opportunityId === opp.id)).toBe(true);
    expect(byOrgOwner.some((a) => a.opportunityId === opp.id)).toBe(true);
    expect(byOtherOrg.some((a) => a.opportunityId === opp.id)).toBe(false);
  });

  it("cannot apply to a draft opportunity", async () => {
    const prov = await createProvider("rlstest-prov-draftapp");
    const { owner, org, location } = await createOrg("rlstest-org-draft");
    const opp = await createPostedOpportunity(org.id, location.id, owner.id);
    await serviceDb.update(opportunities).set({ status: "draft" }).where(eq(opportunities.id, opp.id));

    await expect(
      dbAs(prov.user.id, (tx) =>
        tx.insert(applications).values({
          opportunityId: opp.id,
          providerProfileId: prov.profile.id,
          scope: "series",
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("opportunities visibility", () => {
  it("drafts are org-only; posted is public (including anon)", async () => {
    const prov = await createProvider("rlstest-prov-vis");
    const { owner, org, location } = await createOrg("rlstest-org-vis");
    const posted = await createPostedOpportunity(org.id, location.id, owner.id);
    const draft = await createPostedOpportunity(org.id, location.id, owner.id);
    await serviceDb.update(opportunities).set({ status: "draft" }).where(eq(opportunities.id, draft.id));

    const providerSees = await dbAs(prov.user.id, (tx) => tx.select().from(opportunities));
    expect(providerSees.some((o) => o.id === posted.id)).toBe(true);
    expect(providerSees.some((o) => o.id === draft.id)).toBe(false);

    const ownerSees = await dbAs(owner.id, (tx) => tx.select().from(opportunities));
    expect(ownerSees.some((o) => o.id === draft.id)).toBe(true);

    const anonSees = await dbAsAnon((tx) => tx.select().from(opportunities));
    expect(anonSees.some((o) => o.id === posted.id)).toBe(true);
    expect(anonSees.some((o) => o.id === draft.id)).toBe(false);
  });

  it("the pay-visibility CHECK rejects hidden pay on shift posts", async () => {
    const { owner, org, location } = await createOrg("rlstest-org-pay");
    await expect(
      serviceDb.insert(opportunities).values({
        organizationId: org.id,
        locationId: location.id,
        postedByUserId: owner.id,
        type: "one_time_shift",
        title: "no pay shown",
        timezone: "America/New_York",
        status: "posted",
      }),
    ).rejects.toThrow(/opportunities_pay_visibility_check/);
  });
});

describe("messaging", () => {
  it("messages are participant-only; non-participants cannot read or write", async () => {
    const prov = await createProvider("rlstest-prov-msg");
    const outsider = await createProvider("rlstest-prov-outsider");
    const { owner, org, location } = await createOrg("rlstest-org-msg");
    const opp = await createPostedOpportunity(org.id, location.id, owner.id);

    const [thread] = await serviceDb
      .insert(threads)
      .values({
        opportunityId: opp.id,
        organizationId: org.id,
        providerProfileId: prov.profile.id,
      })
      .returning();
    await serviceDb.insert(threadParticipants).values([
      { threadId: thread.id, userId: prov.user.id },
      { threadId: thread.id, userId: owner.id },
    ]);
    await dbAs(prov.user.id, (tx) =>
      tx.insert(messages).values({ threadId: thread.id, senderUserId: prov.user.id, body: "hi" }),
    );

    const byOwner = await dbAs(owner.id, (tx) => tx.select().from(messages));
    expect(byOwner.some((m) => m.threadId === thread.id)).toBe(true);

    const byOutsider = await dbAs(outsider.user.id, (tx) => tx.select().from(messages));
    expect(byOutsider.some((m) => m.threadId === thread.id)).toBe(false);

    await expect(
      dbAs(outsider.user.id, (tx) =>
        tx.insert(messages).values({
          threadId: thread.id,
          senderUserId: outsider.user.id,
          body: "intruding",
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("watch zones, notifications, profiles", () => {
  it("watch zones are owner-only", async () => {
    const a = await createProvider("rlstest-prov-zone-a");
    const b = await createProvider("rlstest-prov-zone-b");
    await serviceDb.execute(sql`
      insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
      values (${a.profile.id}, 'Z', 'radius',
        st_buffer(st_setsrid(st_makepoint(-84.39, 33.75), 4326)::geography, 10000),
        '{"kind":"radius","centerLat":33.75,"centerLng":-84.39,"radiusMeters":10000}'::jsonb)
    `);
    const byB = await dbAs(b.user.id, (tx) => tx.select().from(watchZones));
    expect(byB.some((z) => z.providerProfileId === a.profile.id)).toBe(false);
  });

  it("notifications are own-only and not client-insertable", async () => {
    const a = await createUser("rlstest-notif-a");
    const b = await createUser("rlstest-notif-b");
    await serviceDb.insert(notifications).values({
      userId: a.id,
      kind: "test",
      title: "t",
      body: "b",
    });
    const byB = await dbAs(b.id, (tx) => tx.select().from(notifications));
    expect(byB.some((n) => n.userId === a.id)).toBe(false);

    await expect(
      dbAs(b.id, (tx) =>
        tx.insert(notifications).values({ userId: b.id, kind: "x", title: "x", body: "x" }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("profiles: invisible to strangers, visible to same-org teammates", async () => {
    const stranger = await createUser("rlstest-stranger");
    const { owner, org } = await createOrg("rlstest-org-profiles");
    const teammate = await addMember(org.id, "poster", "rlstest-teammate");

    const byStranger = await dbAs(stranger.id, (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, owner.id)),
    );
    expect(byStranger).toHaveLength(0);

    const byTeammate = await dbAs(teammate.id, (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, owner.id)),
    );
    expect(byTeammate).toHaveLength(1);
  });

  it("founder bootstrap: a user can create an org and claim ownership via dbAs", async () => {
    // The exact onboarding path — caught a policy-recursion bug the
    // service-role fixtures masked (2026-06-10).
    const founder = await createUser("rlstest-founder");
    const orgId = await dbAs(founder.id, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: "rlstest-bootstrap-org",
          slug: `rlstest-bootstrap-${founder.id.slice(0, 8)}`,
          createdByUserId: founder.id,
        })
        .returning({ id: organizations.id });
      await tx.insert(organizationMembers).values({
        organizationId: org.id,
        userId: founder.id,
        role: "owner",
        acceptedAt: new Date(),
      });
      return org.id;
    });
    const members = await dbAs(founder.id, (tx) =>
      tx.select().from(organizationMembers).where(eq(organizationMembers.organizationId, orgId)),
    );
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
  });

  it("a stranger cannot claim ownership of an org they didn't create", async () => {
    const founder = await createUser("rlstest-victim");
    const stranger = await createUser("rlstest-claimer");
    const orgId = await dbAs(founder.id, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: "rlstest-unclaimed-org",
          slug: `rlstest-unclaimed-${founder.id.slice(0, 8)}`,
          createdByUserId: founder.id,
        })
        .returning({ id: organizations.id });
      return org.id; // deliberately no member row yet — the vulnerable moment
    });
    await expect(
      dbAs(stranger.id, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId: orgId,
          userId: stranger.id,
          role: "owner",
          acceptedAt: new Date(),
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("org member lists are isolated between orgs", async () => {
    const orgA = await createOrg("rlstest-org-iso-a");
    const orgB = await createOrg("rlstest-org-iso-b");
    const byA = await dbAs(orgA.owner.id, (tx) => tx.select().from(organizationMembers));
    expect(byA.some((m) => m.organizationId === orgB.org.id)).toBe(false);
  });
});

describe("audit logs & reviews", () => {
  it("audit_logs: direct insert denied, definer fn writes, admin-only select", async () => {
    const user = await createUser("rlstest-audit-user");
    const admin = await createUser("rlstest-audit-admin", { admin: true });

    await expect(
      dbAs(user.id, (tx) =>
        tx.insert(auditLogs).values({ action: "hack", entityType: "x", actingAs: "provider" }),
      ),
    ).rejects.toThrow(/permission denied/);

    await dbAs(user.id, (tx) =>
      tx.execute(sql`select public.record_audit('provider', 'test.action', 'test_entity', null)`),
    );

    const byUser = await dbAs(user.id, (tx) => tx.select().from(auditLogs));
    expect(byUser).toHaveLength(0);

    const byAdmin = await dbAs(admin.id, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "test.action")),
    );
    expect(byAdmin.length).toBeGreaterThan(0);
  });

  it("reviews are deny-all for clients (future-only table)", async () => {
    const user = await createUser("rlstest-reviews");
    const seen = await dbAs(user.id, (tx) => tx.select().from(reviews));
    expect(seen).toHaveLength(0);
    await expect(
      dbAs(user.id, (tx) =>
        tx.insert(reviews).values({
          bookingId: crypto.randomUUID(),
          authorKind: "provider",
          authorUserId: user.id,
          rating: 5,
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
