"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { getAuthUser } from "@/lib/auth/session";
import { sendMessageInTx, type SendResult } from "@/lib/messaging/send";
import { ensureParticipant, getOrCreateThread } from "@/lib/messaging/threads";
import { requireActiveOrg } from "@/lib/org";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";

const uuid = z.string().uuid();

export async function sendBusinessMessageAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const threadId = uuid.safeParse(formData.get("threadId"));
  if (!threadId.success) redirect("/b/messages");
  const back = `/b/messages/${threadId.data}`;

  let result: SendResult;
  try {
    result = await dbAs(user, (tx) =>
      sendMessageInTx(tx, user.id, threadId.data, String(formData.get("body") ?? "")),
    );
  } catch (err) {
    console.error("[send-message:b]", err);
    redirect(`${back}?error=${encodeURIComponent("That message didn't send — try again.")}`);
  }
  if (!result.ok) {
    const text =
      result.reason === "locked"
        ? "This conversation is locked."
        : result.reason === "empty"
          ? "Write a message first."
          : "That conversation isn't available.";
    redirect(`${back}?error=${encodeURIComponent(text)}`);
  }

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "message_received", messageId: result.messageId }),
    "notify-message-received",
  );
  redirect(
    result.flagged
      ? `${back}?warning=${encodeURIComponent(
          "Your message was sent, but it looks like it includes contact details. Sharing those before a booking is confirmed is against the rules, so it was flagged for review.",
        )}`
      : back,
  );
}

const openSchema = z.object({
  opportunityId: uuid,
  providerProfileId: uuid,
});

/**
 * Open (or start) the conversation with one applicant. Creating a thread
 * needs the 'poster' role per RLS; opening an existing one works for any
 * member — getOrCreateThread selects first, so the INSERT only happens when
 * the thread is genuinely new.
 */
export async function openBusinessThreadAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = openSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    providerProfileId: formData.get("providerProfileId"),
  });
  if (!parsed.success) redirect("/b/opportunities");
  const { org } = await requireActiveOrg();
  const backTo = `/b/opportunities/${parsed.data.opportunityId}/applicants`;

  let threadId: string | null = null;
  try {
    threadId = await dbAs(user, async (tx) => {
      const thread = await getOrCreateThread(tx, {
        opportunityId: parsed.data.opportunityId,
        organizationId: org.id,
        providerProfileId: parsed.data.providerProfileId,
      });
      if (!thread) return null;
      await ensureParticipant(tx, thread.id, user.id);
      return thread.id;
    });
  } catch (err) {
    console.error("[open-thread:b]", err);
    redirect(
      `${backTo}?error=` +
        encodeURIComponent(
          "Couldn't start that conversation — you need posting rights on this business.",
        ),
    );
  }
  if (!threadId) {
    redirect(`${backTo}?error=` + encodeURIComponent("That conversation isn't available."));
  }
  redirect(`/b/messages/${threadId}`);
}
