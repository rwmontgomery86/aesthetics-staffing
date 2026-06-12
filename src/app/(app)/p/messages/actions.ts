"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { opportunities } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { sendMessageInTx, type SendResult } from "@/lib/messaging/send";
import { ensureParticipant, getOrCreateThread } from "@/lib/messaging/threads";
import { providerInTx } from "@/lib/provider";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";

const uuid = z.string().uuid();

export async function sendProviderMessageAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const threadId = uuid.safeParse(formData.get("threadId"));
  if (!threadId.success) redirect("/p/messages");
  const back = `/p/messages/${threadId.data}`;

  let result: SendResult;
  try {
    result = await dbAs(user, (tx) =>
      sendMessageInTx(tx, user.id, threadId.data, String(formData.get("body") ?? "")),
    );
  } catch (err) {
    console.error("[send-message:p]", err);
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

/** Get-or-create the conversation for an opportunity I applied to, then jump in. */
export async function openProviderThreadAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = uuid.safeParse(formData.get("opportunityId"));
  if (!parsed.success) redirect("/p/applications");

  const threadId = await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    const [opp] = await tx
      .select({ id: opportunities.id, organizationId: opportunities.organizationId })
      .from(opportunities)
      .where(eq(opportunities.id, parsed.data));
    if (!opp) return null;
    const thread = await getOrCreateThread(tx, {
      opportunityId: opp.id,
      organizationId: opp.organizationId,
      providerProfileId: provider.id,
    });
    if (!thread) return null;
    await ensureParticipant(tx, thread.id, user.id);
    return thread.id;
  });

  if (!threadId) {
    redirect(
      "/p/applications?error=" +
        encodeURIComponent("That conversation isn't available — the opportunity may be gone."),
    );
  }
  redirect(`/p/messages/${threadId}`);
}
