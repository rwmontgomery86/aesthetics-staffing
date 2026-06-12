import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Deliveries — admin" };

const STATUSES = ["all", "queued", "sent", "delivered", "failed", "bounced", "suppressed"] as const;
const CHANNELS = ["all", "email", "sms"] as const;

const STATUS_CHIP: Record<string, string> = {
  queued: "bg-lilac/10 text-lilac",
  sent: "bg-lilac/10 text-lilac",
  delivered: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
  bounced: "bg-danger/10 text-danger",
  suppressed: "bg-ink/5 text-ink-soft",
};

type Row = {
  id: number;
  channel: string;
  recipient: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  queued_at: Ts;
  sent_at: Ts | null;
  kind: string;
  title: string;
}

/** Per-channel delivery log (USER_FLOWS §13) — the first stop for "did the
 *  email/text actually go out?" once Resend/Twilio are live. */
export default async function AdminDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string }>;
}) {
  const [{ status: rawStatus, channel: rawChannel }, contexts] = await Promise.all([
    searchParams,
    requireAdmin(),
  ]);
  const status = STATUSES.includes(rawStatus as (typeof STATUSES)[number])
    ? (rawStatus as string)
    : "all";
  const channel = CHANNELS.includes(rawChannel as (typeof CHANNELS)[number])
    ? (rawChannel as string)
    : "all";

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select d.id, d.channel, d.recipient, d.status, d.provider_message_id, d.error,
               d.queued_at, d.sent_at, n.kind, n.title
        from notification_deliveries d
        join notifications n on n.id = d.notification_id
        where (${status} = 'all' or d.status::text = ${status})
          and (${channel} = 'all' or d.channel::text = ${channel})
        order by d.queued_at desc
        limit 100
      `)
    ).rows,
  );

  const filterLink = (key: "status" | "channel", value: string) => {
    const params = new URLSearchParams();
    if ((key === "status" ? value : status) !== "all")
      params.set("status", key === "status" ? value : status);
    if ((key === "channel" ? value : channel) !== "all")
      params.set("channel", key === "channel" ? value : channel);
    const qs = params.toString();
    return `/admin/deliveries${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Notification deliveries</h1>
      <p className="mt-2 text-ink-soft">
        Every email and text the platform tried to send, newest first. Provider message IDs come
        from Resend/Twilio once those accounts are live.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={filterLink("status", s)}
            className={`rounded-full px-3 py-1 text-sm ${
              status === s ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {CHANNELS.map((c) => (
          <Link
            key={c}
            href={filterLink("channel", c)}
            className={`rounded-full px-3 py-1 text-sm ${
              channel === c ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
            }`}
          >
            {c}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">
          No deliveries match those filters.
        </p>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="oc-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-soft">
                  {row.channel}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[row.status] ?? STATUS_CHIP.suppressed}`}
                >
                  {row.status}
                </span>
                <span className="font-medium">{row.recipient}</span>
                <span className="text-xs text-ink-soft">{row.kind}</span>
                <span className="ml-auto text-xs text-ink-soft">
                  {ts(row.queued_at).toFormat("MMM d · h:mm a")}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-ink-soft">{row.title}</p>
              {row.provider_message_id ? (
                <p className="mt-0.5 text-xs text-ink-soft/80">id: {row.provider_message_id}</p>
              ) : null}
              {row.error ? <p className="mt-0.5 text-xs text-danger">{row.error}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
