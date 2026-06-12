import "server-only";
import { sql } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { DbLike } from "./threads";

export type SystemKind = "applied" | "offered" | "confirmed" | "canceled";

/**
 * Milestone markers in-thread (USER_FLOWS §8.4): applied / offered /
 * confirmed / canceled. sender_user_id is null, which only the service role
 * can write (the RLS insert policy requires sender = auth.uid()) — so these
 * are posted exclusively by the notify-event worker. Idempotent on
 * (thread, kind, eventKey) because pg-boss retries after partial failures.
 */
export async function postSystemMessage(
  db: DbLike,
  input: {
    threadId: string;
    kind: SystemKind;
    eventKey: string;
    body: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const existing = await db.execute<{ id: string }>(sql`
    select id from messages
    where thread_id = ${input.threadId} and system_kind = ${input.kind}
      and system_payload ->> 'eventKey' = ${input.eventKey}
    limit 1
  `);
  if (existing.rows.length > 0) return;
  await db.insert(messages).values({
    threadId: input.threadId,
    senderUserId: null,
    body: input.body,
    systemKind: input.kind,
    systemPayload: { ...(input.payload ?? {}), eventKey: input.eventKey },
  });
}
