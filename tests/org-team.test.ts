import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  locations,
  opportunities,
  organizationInvites,
  organizationMembers,
  organizations,
} from "@/db/schema";
import { addMember, createOrg, createUser } from "./helpers/fixtures";

/**
 * Phase 4 exit criteria, RLS-proven through dbAs(): posters can post but not
 * manage the team/org/locations; admins can; invite acceptance is bound to
 * the invited email AND the invited role (the role check is the 2026-06-11
 * policy fix — a poster invite must not be redeemable as owner).
 */

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await endRlsPool();
  await servicePool.end();
});

function inviteRow(
  orgId: string,
  invitedBy: string,
  email: string,
  role: "owner" | "admin" | "poster",
  expiresInMs = 60_000,
) {
  return {
    organizationId: orgId,
    email,
    role,
    tokenHash: `rlstest-${crypto.randomUUID()}`,
    invitedByUserId: invitedBy,
    expiresAt: new Date(Date.now() + expiresInMs),
  };
}

describe("poster boundary (can post, can't manage)", () => {
  it("a poster can create an opportunity", async () => {
    const { org, location } = await createOrg("rlstest-poster-can-post");
    const poster = await addMember(org.id, "poster", "rlstest-poster1");

    const inserted = await dbAs(poster.id, (tx) =>
      tx
        .insert(opportunities)
        .values({
          organizationId: org.id,
          locationId: location.id,
          postedByUserId: poster.id,
          type: "one_time_shift",
          title: "RLS poster test shift",
          payKind: "fixed",
          payUnit: "hour",
          payMinCents: 9000,
        })
        .returning({ id: opportunities.id }),
    );
    expect(inserted).toHaveLength(1);
  });

  it("a poster cannot add organization members", async () => {
    const { org } = await createOrg("rlstest-poster-nomember");
    const poster = await addMember(org.id, "poster", "rlstest-poster2");
    const outsider = await createUser("rlstest-outsider1");

    await expect(
      dbAs(poster.id, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId: org.id,
          userId: outsider.id,
          role: "poster",
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a poster cannot create invites", async () => {
    const { org } = await createOrg("rlstest-poster-noinvite");
    const poster = await addMember(org.id, "poster", "rlstest-poster3");

    await expect(
      dbAs(poster.id, (tx) =>
        tx
          .insert(organizationInvites)
          .values(inviteRow(org.id, poster.id, "nobody@test.local", "poster")),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a poster cannot edit the org profile (update filtered to zero rows)", async () => {
    const { org } = await createOrg("rlstest-poster-noorg");
    const poster = await addMember(org.id, "poster", "rlstest-poster4");

    const updated = await dbAs(poster.id, (tx) =>
      tx
        .update(organizations)
        .set({ name: "hijacked" })
        .where(eq(organizations.id, org.id))
        .returning({ id: organizations.id }),
    );
    expect(updated).toHaveLength(0);
  });

  it("a poster cannot add locations", async () => {
    const { org } = await createOrg("rlstest-poster-noloc");
    const poster = await addMember(org.id, "poster", "rlstest-poster5");

    await expect(
      dbAs(poster.id, (tx) =>
        tx.insert(locations).values({
          organizationId: org.id,
          name: "Poster's rogue location",
          addressLine1: "1 Nope St",
          city: "Atlanta",
          state: "GA",
          zip: "30309",
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("admin powers", () => {
  it("an admin can add a second location and edit the org", async () => {
    const { org } = await createOrg("rlstest-admin-loc");
    const admin = await addMember(org.id, "admin", "rlstest-admin1");

    // createOrg seeds the first location; this is the "second location works"
    // exit criterion.
    const inserted = await dbAs(admin.id, (tx) =>
      tx
        .insert(locations)
        .values({
          organizationId: org.id,
          name: "Second studio",
          addressLine1: "2 Test Ave",
          city: "Decatur",
          state: "GA",
          zip: "30030",
        })
        .returning({ id: locations.id }),
    );
    expect(inserted).toHaveLength(1);

    const updated = await dbAs(admin.id, (tx) =>
      tx
        .update(organizations)
        .set({ description: "Updated by admin" })
        .where(eq(organizations.id, org.id))
        .returning({ id: organizations.id }),
    );
    expect(updated).toHaveLength(1);
  });

  it("an admin can create and revoke invites", async () => {
    const { org } = await createOrg("rlstest-admin-invite");
    const admin = await addMember(org.id, "admin", "rlstest-admin2");

    const [invite] = await dbAs(admin.id, (tx) =>
      tx
        .insert(organizationInvites)
        .values(inviteRow(org.id, admin.id, "invitee@test.local", "poster"))
        .returning({ id: organizationInvites.id }),
    );
    expect(invite.id).toBeTruthy();

    await dbAs(admin.id, (tx) =>
      tx.delete(organizationInvites).where(eq(organizationInvites.id, invite.id)),
    );
    const remaining = await serviceDb
      .select()
      .from(organizationInvites)
      .where(eq(organizationInvites.id, invite.id));
    expect(remaining).toHaveLength(0);
  });
});

describe("invite acceptance (email- and role-bound)", () => {
  it("the invited email can join with the invited role", async () => {
    const { owner, org } = await createOrg("rlstest-accept-ok");
    const invitee = await createUser("rlstest-invitee1");
    await serviceDb
      .insert(organizationInvites)
      .values(inviteRow(org.id, owner.id, invitee.email, "poster"));

    // No .returning() here: INSERT…RETURNING also runs the SELECT policy, and
    // org_members visibility comes from being a member — which the snapshot
    // doesn't show during the very insert that creates the membership.
    await dbAs({ id: invitee.id, email: invitee.email }, (tx) =>
      tx.insert(organizationMembers).values({
        organizationId: org.id,
        userId: invitee.id,
        role: "poster",
        acceptedAt: new Date(),
      }),
    );
    const joined = await serviceDb
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, invitee.id),
        ),
      );
    expect(joined).toHaveLength(1);
    expect(joined[0].role).toBe("poster");
  });

  it("a poster invite cannot be redeemed as owner or admin (no role escalation)", async () => {
    const { owner, org } = await createOrg("rlstest-accept-escalate");
    const invitee = await createUser("rlstest-invitee2");
    await serviceDb
      .insert(organizationInvites)
      .values(inviteRow(org.id, owner.id, invitee.email, "poster"));

    for (const role of ["owner", "admin"] as const) {
      await expect(
        dbAs({ id: invitee.id, email: invitee.email }, (tx) =>
          tx.insert(organizationMembers).values({
            organizationId: org.id,
            userId: invitee.id,
            role,
            acceptedAt: new Date(),
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("someone else's invite is invisible and unusable", async () => {
    const { owner, org } = await createOrg("rlstest-accept-wrongemail");
    const invitee = await createUser("rlstest-invitee3");
    const stranger = await createUser("rlstest-stranger1");
    await serviceDb
      .insert(organizationInvites)
      .values(inviteRow(org.id, owner.id, invitee.email, "poster"));

    const visible = await dbAs({ id: stranger.id, email: stranger.email }, (tx) =>
      tx
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.organizationId, org.id)),
    );
    expect(visible).toHaveLength(0);

    await expect(
      dbAs({ id: stranger.id, email: stranger.email }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId: org.id,
          userId: stranger.id,
          role: "poster",
          acceptedAt: new Date(),
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("an expired invite cannot be used", async () => {
    const { owner, org } = await createOrg("rlstest-accept-expired");
    const invitee = await createUser("rlstest-invitee4");
    await serviceDb
      .insert(organizationInvites)
      .values(inviteRow(org.id, owner.id, invitee.email, "poster", -60_000));

    await expect(
      dbAs({ id: invitee.id, email: invitee.email }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId: org.id,
          userId: invitee.id,
          role: "poster",
          acceptedAt: new Date(),
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("the invitee can see their own invite (for the accept page)", async () => {
    const { owner, org } = await createOrg("rlstest-accept-visible");
    const invitee = await createUser("rlstest-invitee5");
    await serviceDb
      .insert(organizationInvites)
      .values(inviteRow(org.id, owner.id, invitee.email, "admin"));

    const visible = await dbAs({ id: invitee.id, email: invitee.email }, (tx) =>
      tx
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.organizationId, org.id)),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].role).toBe("admin");
  });
});

describe("leaving and removal", () => {
  it("a member can remove themselves (leave)", async () => {
    const { org } = await createOrg("rlstest-leave");
    const poster = await addMember(org.id, "poster", "rlstest-leaver");

    await dbAs(poster.id, (tx) =>
      tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userId, poster.id),
          ),
        ),
    );
    const remaining = await serviceDb
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, poster.id),
        ),
      );
    expect(remaining).toHaveLength(0);
  });

  it("a poster cannot remove other members (delete filtered to zero rows)", async () => {
    const { owner, org } = await createOrg("rlstest-noremove");
    const poster = await addMember(org.id, "poster", "rlstest-poster6");

    await dbAs(poster.id, (tx) =>
      tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userId, owner.id),
          ),
        ),
    );
    const stillThere = await serviceDb
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, owner.id),
        ),
      );
    expect(stillThere).toHaveLength(1);
  });
});
