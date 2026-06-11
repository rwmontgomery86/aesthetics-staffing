import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import { notificationDeliveries } from "@/db/schema";

/**
 * Resend event webhook (svix-signed). Updates delivery rows by provider
 * message id; bounces and complaints become the suppression signal the
 * dispatcher checks before future sends. Signature verification runs when
 * RESEND_WEBHOOK_SECRET is set; stub mode accepts unsigned posts so the
 * status flow can be exercised before Resend is provisioned.
 */

function validSignature(req: NextRequest, payload: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // stub mode
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return signatures.split(" ").some((part) => {
    const candidate = part.split(",")[1];
    if (!candidate || candidate.length !== signed.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(signed));
  });
}

export async function POST(req: NextRequest) {
  const payload = await req.text();
  if (!validSignature(req, payload)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const messageId = event.data?.email_id;
  if (!messageId || !event.type) return NextResponse.json({ ok: true });

  const updates: Partial<typeof notificationDeliveries.$inferInsert> | null =
    event.type === "email.delivered"
      ? { status: "delivered", deliveredAt: new Date() }
      : event.type === "email.bounced"
        ? { status: "bounced", failedAt: new Date(), error: "bounced" }
        : event.type === "email.complained"
          ? { status: "bounced", failedAt: new Date(), error: "complaint" }
          : event.type === "email.delivery_delayed"
            ? null // transient; leave as sent
            : null;

  if (updates) {
    await serviceDb
      .update(notificationDeliveries)
      .set(updates)
      .where(eq(notificationDeliveries.providerMessageId, messageId));
  }
  return NextResponse.json({ ok: true });
}
