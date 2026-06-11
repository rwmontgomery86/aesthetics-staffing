import { eq, inArray, and } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import { notificationDeliveries, notifications } from "@/db/schema";
import { sendEmail } from "@/lib/notifications/channels/email";
import { sendSms } from "@/lib/notifications/channels/sms";
import { brand } from "@/config/brand";

/**
 * Delivery executors. Idempotent: a delivery already past "queued"/"failed"
 * is skipped, so pg-boss retries and duplicate jobs can't double-send.
 * Failures mark the row and re-throw so pg-boss applies retry/backoff.
 */

async function loadDelivery(deliveryId: number) {
  const [row] = await serviceDb
    .select({ delivery: notificationDeliveries, notification: notifications })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(
      and(
        eq(notificationDeliveries.id, deliveryId),
        inArray(notificationDeliveries.status, ["queued", "failed"]),
      ),
    );
  return row ?? null;
}

export async function deliverEmailJob(deliveryId: number): Promise<void> {
  const row = await loadDelivery(deliveryId);
  if (!row) return;

  const result = await sendEmail({
    to: row.delivery.recipient,
    subject: row.notification.title,
    text: row.notification.body,
    actionUrl: row.notification.actionUrl,
    actionLabel: "Open",
  });

  if (result.ok) {
    await serviceDb
      .update(notificationDeliveries)
      .set({ status: "sent", sentAt: new Date(), providerMessageId: result.providerMessageId })
      .where(eq(notificationDeliveries.id, deliveryId));
  } else {
    await serviceDb
      .update(notificationDeliveries)
      .set({ status: "failed", failedAt: new Date(), error: result.error })
      .where(eq(notificationDeliveries.id, deliveryId));
    throw new Error(`email delivery ${deliveryId} failed: ${result.error}`);
  }
}

export async function deliverSmsJob(deliveryId: number): Promise<void> {
  const row = await loadDelivery(deliveryId);
  if (!row) return;

  // SMS is terse: brand prefix, the title, and the link.
  const body = `${brand.shortName}: ${row.notification.title}${
    row.notification.actionUrl ? `\n${row.notification.actionUrl}` : ""
  }\nReply STOP to opt out.`;

  const result = await sendSms({ to: row.delivery.recipient, body });

  if (result.ok) {
    await serviceDb
      .update(notificationDeliveries)
      .set({ status: "sent", sentAt: new Date(), providerMessageId: result.providerMessageId })
      .where(eq(notificationDeliveries.id, deliveryId));
  } else {
    await serviceDb
      .update(notificationDeliveries)
      .set({ status: "failed", failedAt: new Date(), error: result.error })
      .where(eq(notificationDeliveries.id, deliveryId));
    throw new Error(`sms delivery ${deliveryId} failed: ${result.error}`);
  }
}
