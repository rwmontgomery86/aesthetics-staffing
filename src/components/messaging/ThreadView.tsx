import Link from "next/link";
import { DateTime } from "luxon";
import { AutoRefresh } from "./AutoRefresh";

export interface ThreadMessage {
  id: string;
  senderUserId: string | null;
  body: string;
  contactFlagged: boolean;
  systemKind: string | null;
  createdAt: Date;
}

/**
 * The conversation surface shared by the provider side, the business side,
 * and the admin read-only view. Server component — the composer is a plain
 * form posting to the side's server action; AutoRefresh polls for the rest.
 */
export function ThreadView({
  title,
  opportunityHref,
  counterpartyName,
  messages,
  viewerUserId,
  providerUserId,
  providerName,
  orgName,
  contactRevealed,
  locked,
  composerAction,
  threadId,
  showFlags = false,
  warning,
  error,
}: {
  title: string;
  opportunityHref: string | null;
  counterpartyName: string;
  messages: ThreadMessage[];
  /** null renders every bubble left-aligned (admin review). */
  viewerUserId: string | null;
  providerUserId: string;
  providerName: string;
  orgName: string;
  contactRevealed: boolean;
  locked: boolean;
  /** Omit both for read-only views (admin). */
  composerAction?: (formData: FormData) => Promise<void>;
  threadId?: string;
  showFlags?: boolean;
  warning?: string;
  error?: string;
}) {
  const senderLabel = (senderUserId: string) =>
    senderUserId === providerUserId ? providerName : orgName;
  const fmt = (date: Date) =>
    DateTime.fromJSDate(date, { zone: "America/New_York" }).toFormat("MMM d · h:mm a");

  return (
    <div className="mx-auto max-w-2xl">
      <AutoRefresh />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{counterpartyName}</h1>
          <p className="text-sm text-ink-soft">
            About:{" "}
            {opportunityHref ? (
              <Link href={opportunityHref} className="underline hover:text-lilac">
                {title}
              </Link>
            ) : (
              title
            )}
          </p>
        </div>
        {!contactRevealed ? (
          <p className="text-xs text-ink-soft">
            Contact details unlock when a booking is confirmed.
          </p>
        ) : null}
      </div>

      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {warning ? (
        <p className="mt-4 rounded-lg border border-blush bg-blush/10 px-3 py-2 text-sm text-blush-deep">
          {warning}
        </p>
      ) : null}

      <div className="oc-card mt-6 space-y-3 p-5">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">
            No messages yet — say hello and keep everything about the work in one place.
          </p>
        ) : (
          messages.map((message) => {
            if (message.senderUserId == null) {
              return (
                <p key={message.id} className="py-1 text-center text-xs text-ink-soft">
                  — {message.body} <span className="opacity-70">{fmt(message.createdAt)}</span> —
                </p>
              );
            }
            const mine = viewerUserId != null && message.senderUserId === viewerUserId;
            return (
              <div key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[80%] rounded-card px-3.5 py-2.5 ${
                    mine ? "bg-lilac/10" : "bg-ink/5"
                  }`}
                >
                  <p className="text-xs font-medium text-ink-soft">
                    {mine ? "You" : senderLabel(message.senderUserId)}
                  </p>
                  <p className="whitespace-pre-line text-sm">{message.body}</p>
                  <p className="mt-1 text-right text-[11px] text-ink-soft/80">
                    {fmt(message.createdAt)}
                    {showFlags && message.contactFlagged ? (
                      <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 font-medium text-danger">
                        contact flagged
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {composerAction ? (
        locked ? (
          <p className="oc-notice mt-4">
            This conversation has been locked by the platform team — no new messages can be sent.
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-xs text-ink-soft">
              Do not share patient information. Do not request or provide patient-identifying
              details. Keep contact and payment arrangements consistent with platform terms.
              {!contactRevealed
                ? " Contact details stay on-platform until a booking is confirmed."
                : ""}
            </p>
            <form action={composerAction} className="mt-2 flex items-end gap-2">
              <input type="hidden" name="threadId" value={threadId} />
              <textarea
                name="body"
                rows={3}
                required
                maxLength={5000}
                placeholder="Write a message…"
                className="oc-input resize-y"
              />
              <button type="submit" className="oc-btn shrink-0">
                Send
              </button>
            </form>
          </div>
        )
      ) : null}
    </div>
  );
}
