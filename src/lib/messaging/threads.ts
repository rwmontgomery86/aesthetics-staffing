import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { threadParticipants, threads } from "@/db/schema";

/**
 * Thread helpers shared by the RLS side (server actions/pages inside dbAs)
 * and the worker (service role): both Tx and serviceDb satisfy DbLike, and
 * RLS — not this module — decides who may actually create or see a thread.
 */
export type DbLike = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface ThreadContext {
  opportunityId: string;
  organizationId: string;
  providerProfileId: string;
  applicationId?: string | null;
}

/**
 * Threads are ALWAYS context-bound: UNIQUE (opportunity_id,
 * provider_profile_id) makes this a race-safe get-or-create. Returns
 * undefined when RLS hides the thread from the caller.
 */
export async function getOrCreateThread(db: DbLike, ctx: ThreadContext) {
  const lookup = () =>
    db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.opportunityId, ctx.opportunityId),
          eq(threads.providerProfileId, ctx.providerProfileId),
        ),
      );
  // Select first: opening an existing thread must not attempt an INSERT the
  // viewer's role couldn't pass (e.g. an org member below 'poster').
  let [thread] = await lookup();
  if (!thread) {
    await db
      .insert(threads)
      .values({
        opportunityId: ctx.opportunityId,
        organizationId: ctx.organizationId,
        providerProfileId: ctx.providerProfileId,
        applicationId: ctx.applicationId ?? null,
      })
      .onConflictDoNothing();
    [thread] = await lookup();
  }
  if (thread && thread.applicationId == null && ctx.applicationId) {
    await db
      .update(threads)
      .set({ applicationId: ctx.applicationId })
      .where(and(eq(threads.id, thread.id), isNull(threads.applicationId)));
  }
  return thread;
}

/** Lazy join (DATABASE_SCHEMA §6): you may add YOURSELF to any thread you can see. */
export async function ensureParticipant(db: DbLike, threadId: string, userId: string) {
  await db.insert(threadParticipants).values({ threadId, userId }).onConflictDoNothing();
}

/** Own-row update (RLS: thread_participants_update_self). */
export async function markThreadRead(db: DbLike, threadId: string, userId: string) {
  await db
    .update(threadParticipants)
    .set({ lastReadAt: sql`now()`, unreadCount: 0 })
    .where(
      and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, userId)),
    );
}
