import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { messages, threads } from "@/db/schema";
import { detectsContactInfo } from "./contact-screen";
import { ensureParticipant } from "./threads";

export type SendResult =
  | { ok: true; flagged: boolean; messageId: string }
  | { ok: false; reason: "not_found" | "locked" | "empty" };

/**
 * The one write path for human messages, under the SENDER's RLS connection:
 * the insert policy enforces participant + thread-not-locked, this function
 * adds the pre-reveal contact screen (warn-and-flag, never drop) and the
 * lazy participant join. Unread counters and thread recency are bumped by
 * the message_fanout trigger (drizzle/manual/0007) — the sender has no
 * UPDATE right on other participants' rows.
 */
export async function sendMessageInTx(
  tx: Tx,
  userId: string,
  threadId: string,
  body: string,
): Promise<SendResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId));
  if (!thread) return { ok: false, reason: "not_found" };
  if (thread.lockedAt) return { ok: false, reason: "locked" };

  await ensureParticipant(tx, threadId, userId);

  const flagged = thread.contactRevealedAt == null && detectsContactInfo(trimmed);
  // RETURNING is safe here (CLAUDE.md rule 10): visibility comes from the
  // participant row inserted in the PRIOR statement, not from this row.
  const [inserted] = await tx
    .insert(messages)
    .values({
      threadId,
      senderUserId: userId,
      body: trimmed,
      contactFlagged: flagged,
    })
    .returning({ id: messages.id });
  return { ok: true, flagged, messageId: inserted.id };
}
