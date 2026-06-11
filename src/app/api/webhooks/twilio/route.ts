import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import { notificationDeliveries, profiles, smsConsentLog } from "@/db/schema";

/**
 * Twilio webhook — two payload shapes on one endpoint:
 *   - Inbound messages (Body/From): STOP/START/HELP keyword consent (TCPA).
 *   - Status callbacks (MessageStatus/MessageSid): delivery row updates.
 *
 * Signature validation runs when TWILIO_AUTH_TOKEN is set; in stub mode
 * (no Twilio yet — 10DLC pending) the endpoint accepts unsigned posts so the
 * flow can be exercised end-to-end in staging.
 */

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);

function validSignature(req: NextRequest, params: URLSearchParams): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // stub mode
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;
  // Twilio's scheme: URL + form params sorted by key, concatenated, HMAC-SHA1.
  const url = `${process.env.APP_BASE_URL ?? ""}/api/webhooks/twilio`;
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const payload = url + sorted.map(([k, v]) => k + v).join("");
  const expected = createHmac("sha1", authToken).update(payload).digest("base64");
  return expected === signature;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  if (!validSignature(req, params)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const messageStatus = params.get("MessageStatus");
  const messageSid = params.get("MessageSid") ?? params.get("SmsSid");

  // Status callback → update the delivery row.
  if (messageStatus && messageSid && !params.get("Body")) {
    const updates: Partial<typeof notificationDeliveries.$inferInsert> =
      messageStatus === "delivered"
        ? { status: "delivered", deliveredAt: new Date() }
        : messageStatus === "failed" || messageStatus === "undelivered"
          ? { status: "failed", failedAt: new Date(), error: `twilio status: ${messageStatus}` }
          : {};
    if (Object.keys(updates).length > 0) {
      await serviceDb
        .update(notificationDeliveries)
        .set(updates)
        .where(eq(notificationDeliveries.providerMessageId, messageSid));
    }
    return NextResponse.json({ ok: true });
  }

  // Inbound keyword → consent handling.
  const from = params.get("From");
  const body = (params.get("Body") ?? "").trim().toLowerCase();
  if (!from) return NextResponse.json({ ok: true });

  const [profile] = await serviceDb
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.phoneE164, from));

  let reply: string | null = null;
  if (STOP_WORDS.has(body)) {
    if (profile) {
      await serviceDb
        .update(profiles)
        .set({ smsOptedIn: false, smsOptOutAt: new Date() })
        .where(eq(profiles.id, profile.id));
    }
    await serviceDb.insert(smsConsentLog).values({
      userId: profile?.id ?? null,
      phoneE164: from,
      action: "opt_out",
      source: "keyword",
      rawMessage: params.get("Body"),
    });
    // Twilio's Advanced Opt-Out usually answers STOP itself; stay silent.
  } else if (START_WORDS.has(body)) {
    if (profile) {
      await serviceDb
        .update(profiles)
        .set({ smsOptedIn: true, smsOptOutAt: null })
        .where(eq(profiles.id, profile.id));
    }
    await serviceDb.insert(smsConsentLog).values({
      userId: profile?.id ?? null,
      phoneE164: from,
      action: "opt_in",
      source: "keyword",
      rawMessage: params.get("Body"),
    });
    reply = "You're opted back in to alerts. Reply STOP to opt out.";
  } else if (body === "help") {
    await serviceDb.insert(smsConsentLog).values({
      userId: profile?.id ?? null,
      phoneE164: from,
      action: "help",
      source: "keyword",
      rawMessage: params.get("Body"),
    });
    reply = `Alerts from ${process.env.NEXT_PUBLIC_APP_NAME ?? "our staffing app"}. Reply STOP to opt out. Support: ${process.env.SUPPORT_EMAIL ?? "support@example.test"}`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${
    reply ? `<Message>${reply}</Message>` : ""
  }</Response>`;
  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}
