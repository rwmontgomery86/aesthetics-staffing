import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  messages,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  organizationMembers,
  threadParticipants,
  threads,
} from "@/db/schema";
import { detectsContactInfo } from "@/lib/messaging/contact-screen";
import { sendMessageInTx } from "@/lib/messaging/send";
import { postSystemMessage } from "@/lib/messaging/system";
import {
  ensureParticipant,
  getOrCreateThread,
  markThreadRead,
} from "@/lib/messaging/threads";
import { notifyEventJob } from "@/workers/jobs/events";
import { stopBoss } from "@/lib/queue";
import {
  createOrg,
  createPostedOpportunity,
  createProvider,
  createUser,
} from "./helpers/fixtures";

/**
 * Phase 8 proofs (exit criteria): participant-only RLS on threads/messages,
 * the pre-reveal contact flag (fires before, not after), unread counters via
 * the message_fanout trigger, idempotent system messages, and the
 * message_received notification honoring category preferences.
 */

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await stopBoss();
  await endRlsPool();
  await servicePool.end();
});

/** Org + posted opportunity + provider + their thread (the post-apply shape). */
async function arrange(label: string) {
  const { owner, org, location } = await createOrg(`rlstest-${label}`);
  const opp = await createPostedOpportunity(org.id, location.id, owner.id);
  const { user, profile } = await createProvider(`${label}-prov`);
  const thread = (await getOrCreateThread(serviceDb, {
    opportunityId: opp.id,
    organizationId: org.id,
    providerProfileId: profile.id,
  }))!;
  await ensureParticipant(serviceDb, thread.id, user.id);
  return { owner, org, opp, providerUser: user, provider: profile, thread };
}

describe("contact screen", () => {
  it("detects emails and US phone shapes", () => {
    for (const body of [
      "reach me at jane.doe+spa@gmail.com",
      "call 404-555-0100 anytime",
      "call (404) 555 0100",
      "my cell is 404.555.0100",
      "+1 404 555 0100 after 5",
      "text 4045550100",
    ]) {
      expect(detectsContactInfo(body), body).toBe(true);
    }
  });

  it("leaves ordinary shop talk alone", () => {
    for (const body of [
      "see you at 10:30, suite 100",
      "the rate is $85/hr for 8 hours",
      "license RN-443322 is on my profile",
      "Dec 12, 2026 works for me",
      "room 4045, floor 55",
    ]) {
      expect(detectsContactInfo(body), body).toBe(false);
    }
  });
});

describe("threads & messages RLS", () => {
  it("messages are participant-only; org members see the thread and may self-join", async () => {
    const { owner, org, providerUser, thread } = await arrange("rls");
    await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "hello!"),
    );

    // A stranger provider: no thread, no messages.
    const stranger = await createProvider("rls-stranger");
    const strangerView = await dbAs(stranger.user.id, async (tx) => ({
      threads: await tx.select().from(threads).where(eq(threads.id, thread.id)),
      messages: await tx.select().from(messages).where(eq(messages.threadId, thread.id)),
    }));
    expect(strangerView.threads).toHaveLength(0);
    expect(strangerView.messages).toHaveLength(0);

    // A second org member: thread visible, messages hidden until they join.
    const member = await createUser("rls-member");
    await serviceDb.insert(organizationMembers).values({
      organizationId: org.id,
      userId: member.id,
      role: "poster",
    });
    const before = await dbAs(member.id, async (tx) => ({
      threads: await tx.select().from(threads).where(eq(threads.id, thread.id)),
      messages: await tx.select().from(messages).where(eq(messages.threadId, thread.id)),
    }));
    expect(before.threads).toHaveLength(1);
    expect(before.messages).toHaveLength(0);
    const after = await dbAs(member.id, async (tx) => {
      await ensureParticipant(tx, thread.id, member.id);
      return tx.select().from(messages).where(eq(messages.threadId, thread.id));
    });
    expect(after).toHaveLength(1);

    // A platform admin reads without joining (the audited support path).
    const admin = await createUser("rls-admin", { admin: true });
    const adminView = await dbAs(admin.id, (tx) =>
      tx.select().from(messages).where(eq(messages.threadId, thread.id)),
    );
    expect(adminView).toHaveLength(1);

    // Non-participants cannot write, even the org owner before joining.
    const outsider = await createProvider("rls-writer");
    await expect(
      dbAs(outsider.user.id, (tx) =>
        tx.insert(messages).values({
          threadId: thread.id,
          senderUserId: outsider.user.id,
          body: "let me in",
        }),
      ),
    ).rejects.toThrow();
    void owner;
  });

  it("locked threads reject new messages at both layers", async () => {
    const { providerUser, thread } = await arrange("locked");
    await serviceDb.update(threads).set({ lockedAt: new Date() }).where(eq(threads.id, thread.id));

    const result = await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "anyone there?"),
    );
    expect(result).toEqual({ ok: false, reason: "locked" });

    // Straight to the table, skipping the app check: RLS blocks it too.
    await expect(
      dbAs(providerUser.id, (tx) =>
        tx.insert(messages).values({
          threadId: thread.id,
          senderUserId: providerUser.id,
          body: "raw insert",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("admin thread access", () => {
  it("is audited: the admin view writes a thread.viewed audit row", async () => {
    const { org, providerUser, thread } = await arrange("audit");
    await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "private note"),
    );
    const admin = await createUser("audit-admin", { admin: true });

    // What /admin/threads/[id] does: read the thread + messages under the
    // admin's RLS connection, writing the audit row via the definer.
    const read = await dbAs(admin.id, async (tx) => {
      const rows = await tx.select().from(messages).where(eq(messages.threadId, thread.id));
      await tx.execute(sql`
        select public.record_audit('admin', 'thread.viewed', 'thread', ${thread.id}::uuid, ${org.id}::uuid)
      `);
      return rows;
    });
    expect(read).toHaveLength(1);

    const audit = await serviceDb.execute<{ actor_user_id: string }>(sql`
      select actor_user_id from audit_logs
      where action = 'thread.viewed' and entity_id = ${thread.id}
    `);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_user_id).toBe(admin.id);
  });
});

describe("pre-reveal contact flag", () => {
  it("fires before contact reveal and not after", async () => {
    const { providerUser, thread } = await arrange("flag");
    const before = await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "text me at 404-555-0100"),
    );
    expect(before).toMatchObject({ ok: true, flagged: true });

    await serviceDb
      .update(threads)
      .set({ contactRevealedAt: new Date() })
      .where(eq(threads.id, thread.id));
    const after = await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "text me at 404-555-0100"),
    );
    expect(after).toMatchObject({ ok: true, flagged: false });

    const rows = await serviceDb
      .select({ flagged: messages.contactFlagged })
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .orderBy(messages.createdAt);
    expect(rows.map((r) => r.flagged)).toEqual([true, false]);
  });
});

describe("unread counters (message_fanout trigger)", () => {
  it("increments everyone but the sender; system messages count for all; read resets", async () => {
    const { owner, providerUser, thread } = await arrange("unread");
    await ensureParticipant(serviceDb, thread.id, owner.id);

    await dbAs(providerUser.id, (tx) =>
      sendMessageInTx(tx, providerUser.id, thread.id, "morning!"),
    );
    const counts = async () =>
      Object.fromEntries(
        (
          await serviceDb
            .select({ userId: threadParticipants.userId, unread: threadParticipants.unreadCount })
            .from(threadParticipants)
            .where(eq(threadParticipants.threadId, thread.id))
        ).map((row) => [row.userId, row.unread]),
      );
    expect(await counts()).toEqual({ [providerUser.id]: 0, [owner.id]: 1 });

    await postSystemMessage(serviceDb, {
      threadId: thread.id,
      kind: "confirmed",
      eventKey: "test:unread",
      body: "Booking confirmed.",
    });
    expect(await counts()).toEqual({ [providerUser.id]: 1, [owner.id]: 2 });

    await dbAs(owner.id, (tx) => markThreadRead(tx, thread.id, owner.id));
    expect(await counts()).toEqual({ [providerUser.id]: 1, [owner.id]: 0 });

    const [row] = await serviceDb.select().from(threads).where(eq(threads.id, thread.id));
    expect(row.lastMessageAt).not.toBeNull();
  });
});

describe("system messages", () => {
  it("postSystemMessage is idempotent per (thread, kind, eventKey)", async () => {
    const { thread } = await arrange("sysmsg");
    for (let i = 0; i < 2; i++) {
      await postSystemMessage(serviceDb, {
        threadId: thread.id,
        kind: "offered",
        eventKey: "offered:abc",
        body: "Offer sent.",
      });
    }
    const rows = await serviceDb
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, thread.id), eq(messages.systemKind, "offered")));
    expect(rows).toHaveLength(1);
    expect(rows[0].senderUserId).toBeNull();
  });
});

describe("message_received notifications", () => {
  async function send(providerUserId: string, threadId: string, body: string) {
    const result = await dbAs(providerUserId, (tx) =>
      sendMessageInTx(tx, providerUserId, threadId, body),
    );
    if (!result.ok) throw new Error(`send failed: ${result.reason}`);
    await notifyEventJob({ kind: "message_received", messageId: result.messageId });
    return result.messageId;
  }
  const notificationsFor = (userId: string) =>
    serviceDb
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.kind, "message_received")));

  it("notifies the counterparty (with email by default) and debounces while unread", async () => {
    const { owner, providerUser, thread } = await arrange("notify");

    await send(providerUser.id, thread.id, "first message");
    let rows = await notificationsFor(owner.id);
    expect(rows).toHaveLength(1);
    const deliveries = await serviceDb
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, rows[0].id));
    expect(deliveries.map((d) => d.channel)).toEqual(["email"]);

    // Second message while the first sits unread: no second notification.
    await send(providerUser.id, thread.id, "second message");
    rows = await notificationsFor(owner.id);
    expect(rows).toHaveLength(1);

    // Mark it read and the next message notifies again.
    await serviceDb
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, rows[0].id));
    await send(providerUser.id, thread.id, "third message");
    rows = await notificationsFor(owner.id);
    expect(rows).toHaveLength(2);
  });

  it("respects the messages category preference (email off → no delivery row)", async () => {
    const { owner, providerUser, thread } = await arrange("prefs");
    await serviceDb.insert(notificationPreferences).values({
      userId: owner.id,
      category: "messages",
      email: false,
    });

    await send(providerUser.id, thread.id, "are you there?");
    const rows = await notificationsFor(owner.id);
    expect(rows).toHaveLength(1); // in-app row still lands
    const deliveries = await serviceDb
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, rows[0].id));
    expect(deliveries).toHaveLength(0);
  });

  it("the applied milestone creates the thread and survives a retry", async () => {
    const { owner, org, opp } = await (async () => {
      const { owner, org, location } = await createOrg("rlstest-applied");
      const opp = await createPostedOpportunity(org.id, location.id, owner.id);
      return { owner, org, opp };
    })();
    const { user, profile } = await createProvider("applied-prov");
    const [application] = await serviceDb.execute<{ id: string }>(sql`
      insert into applications (opportunity_id, provider_profile_id, scope, credential_snapshot)
      values (${opp.id}, ${profile.id}, 'series', '[]'::jsonb)
      returning id
    `).then((r) => r.rows);

    for (let i = 0; i < 2; i++) {
      await notifyEventJob({ kind: "application_received", applicationIds: [application.id] });
    }

    const [thread] = await serviceDb
      .select()
      .from(threads)
      .where(and(eq(threads.opportunityId, opp.id), eq(threads.providerProfileId, profile.id)));
    expect(thread).toBeDefined();
    expect(thread.organizationId).toBe(org.id);
    const system = await serviceDb
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, thread.id), eq(messages.systemKind, "applied")));
    expect(system).toHaveLength(1);

    // The provider was joined, so the milestone ticked their unread counter.
    const [participant] = await serviceDb
      .select()
      .from(threadParticipants)
      .where(
        and(
          eq(threadParticipants.threadId, thread.id),
          eq(threadParticipants.userId, user.id),
        ),
      );
    expect(participant?.unreadCount).toBe(1);
    void owner;
  });
});
