import "server-only";
import type { SendResult } from "./email";

/**
 * SMS adapter — Twilio REST API, console stub until the founder's 10DLC
 * registration clears and TWILIO_* env vars exist. Transactional only
 * (locked decision A.5). Env read lazily (route-imported module).
 */

export interface SmsMessage {
  /** E.164. */
  to: string;
  body: string;
}

export async function sendSms(msg: SmsMessage): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !authToken || !fromNumber) {
    console.log(`[sms:stub] → ${msg.to} | ${msg.body}`);
    return { ok: true, providerMessageId: `stub-${crypto.randomUUID()}`, stub: true };
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: msg.to, From: fromNumber, Body: msg.body }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, providerMessageId: null, error: `twilio ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, providerMessageId: data.sid ?? null };
  } catch (err) {
    return { ok: false, providerMessageId: null, error: err instanceof Error ? err.message : "send failed" };
  }
}
