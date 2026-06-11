import "server-only";
import { brand } from "@/config/brand";

/**
 * Email adapter — Resend HTTP API, console stub when RESEND_API_KEY is
 * absent (NotifEyes pattern: absence must never crash dev/CI; the stub IS
 * the staging behavior until the founder provisions Resend).
 * Env read lazily — this module is route-imported (CI builds without env).
 */

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  error?: string;
  stub?: boolean;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  actionUrl?: string | null;
  actionLabel?: string;
}

function renderHtml(msg: EmailMessage): string {
  const button = msg.actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#8d7bb8;border-radius:10px;">
         <a href="${msg.actionUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;">${msg.actionLabel ?? "Open"}</a>
       </td></tr></table>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#faf8fc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2733;">
      <tr><td style="font-size:15px;font-weight:700;color:#8d7bb8;padding-bottom:16px;">${brand.name}</td></tr>
      <tr><td style="font-size:16px;line-height:1.55;white-space:pre-line;">${msg.text}</td></tr>
      <tr><td>${button}</td></tr>
      <tr><td style="font-size:12px;color:#8a8494;padding-top:24px;">You're receiving this because of your ${brand.name} alert settings. Adjust them any time in the app.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[email:stub] → ${msg.to} | ${msg.subject}\n${msg.text}${msg.actionUrl ? `\n${msg.actionLabel ?? "Open"}: ${msg.actionUrl}` : ""}\n`,
    );
    return { ok: true, providerMessageId: `stub-${crypto.randomUUID()}`, stub: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? `${brand.name} <onboarding@resend.dev>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.text + (msg.actionUrl ? `\n\n${msg.actionLabel ?? "Open"}: ${msg.actionUrl}` : ""),
        html: renderHtml(msg),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, providerMessageId: null, error: `resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, providerMessageId: data.id ?? null };
  } catch (err) {
    return { ok: false, providerMessageId: null, error: err instanceof Error ? err.message : "send failed" };
  }
}
