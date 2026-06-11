import Link from "next/link";
import { DateTime } from "luxon";
import { desc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  applications,
  opportunities,
  opportunityOccurrences,
  organizations,
} from "@/db/schema";
import { TermsBox } from "@/components/TermsBox";
import { opportunityTypeLabel } from "@/lib/opportunity-types";
import { requireProviderRow } from "@/lib/provider";
import { acceptOfferAction, declineOfferAction, withdrawApplicationAction } from "./actions";

export const metadata = { title: "My applications" };

const STATUS_BADGE: Record<string, { text: string; tone: string }> = {
  submitted: { text: "Submitted", tone: "bg-lilac/10 text-lilac" },
  viewed: { text: "Viewed", tone: "bg-lilac/10 text-lilac" },
  shortlisted: { text: "Shortlisted", tone: "bg-blush/30 text-blush-deep" },
  offered: { text: "Selected — action needed", tone: "bg-success/10 text-success" },
  accepted: { text: "Booked", tone: "bg-success/10 text-success" },
  declined: { text: "Declined", tone: "bg-ink/5 text-ink-soft" },
  withdrawn: { text: "Withdrawn", tone: "bg-ink/5 text-ink-soft" },
  expired: { text: "Closed", tone: "bg-ink/5 text-ink-soft" },
};

const ACTIVE = new Set(["submitted", "viewed", "shortlisted", "offered"]);

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const rows = await dbAs(user, async (tx) =>
    tx
      .select({
        id: applications.id,
        status: applications.status,
        scope: applications.scope,
        message: applications.message,
        createdAt: applications.createdAt,
        statusChangedAt: applications.statusChangedAt,
        opportunityId: applications.opportunityId,
        // Left joins: an expired or canceled post disappears from the
        // provider's RLS view, but their application history must not.
        title: opportunities.title,
        type: opportunities.type,
        timezone: opportunities.timezone,
        orgName: organizations.name,
        occurrenceStartsAt: opportunityOccurrences.startsAt,
      })
      .from(applications)
      .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .leftJoin(organizations, eq(organizations.id, opportunities.organizationId))
      .leftJoin(opportunityOccurrences, eq(opportunityOccurrences.id, applications.occurrenceId))
      .where(eq(applications.providerProfileId, provider.id))
      .orderBy(desc(applications.statusChangedAt)),
  );

  type Row = (typeof rows)[number];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(row.opportunityId) ?? [];
    list.push(row);
    groups.set(row.opportunityId, list);
  }

  const fmtDate = (date: Date, timezone: string | null) =>
    DateTime.fromJSDate(date, { zone: timezone ?? "America/New_York" }).toFormat(
      "EEE, MMM d · h:mm a",
    );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">My applications</h1>
      <p className="mt-2 text-ink-soft">
        Everything you&apos;ve applied to, newest first. When a business selects you, the offer
        shows up here for your confirmation.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {groups.size === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          <p>No applications yet.</p>
          <p className="mt-1">
            Your{" "}
            <Link href="/p/zones" className="underline hover:text-lilac">
              watch zones
            </Link>{" "}
            alert you the moment matching work posts — applying takes one tap from there.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {[...groups.entries()].map(([opportunityId, group]) => {
            const first = group[0];
            const hasOffer = group.some((row) => row.status === "offered");
            const hasActive = group.some((row) => ACTIVE.has(row.status));
            return (
              <div key={opportunityId} className="oc-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    {first.title ? (
                      <Link
                        href={`/o/${opportunityId}`}
                        className="font-semibold hover:text-lilac"
                      >
                        {first.title}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink-soft">
                        Opportunity no longer listed
                      </span>
                    )}
                    <p className="text-sm text-ink-soft">
                      {first.orgName ?? "—"}
                      {first.type ? <> · {opportunityTypeLabel(first.type)}</> : null}
                    </p>
                  </div>
                  <p className="text-xs text-ink-soft">
                    Applied {DateTime.fromJSDate(first.createdAt).toFormat("MMM d")}
                  </p>
                </div>

                <ul className="mt-3 space-y-1.5 text-sm">
                  {group.map((row) => {
                    const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.submitted;
                    return (
                      <li key={row.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {row.occurrenceStartsAt
                            ? fmtDate(row.occurrenceStartsAt, row.timezone)
                            : "Whole series"}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.tone}`}
                        >
                          {badge.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {hasOffer ? (
                  <div className="mt-4 rounded-lg border border-success/40 bg-success/5 p-4">
                    <p className="font-medium">You&apos;ve been selected 🎉</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      Review the booking terms and confirm. Once you do, the booking is locked in
                      and contact details unlock for both sides.
                    </p>
                    <form action={acceptOfferAction} className="mt-3 space-y-3">
                      <input type="hidden" name="opportunityId" value={opportunityId} />
                      <TermsBox />
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="submit" className="oc-btn">
                          Confirm booking
                        </button>
                      </div>
                    </form>
                    <form action={declineOfferAction} className="mt-2">
                      <input type="hidden" name="opportunityId" value={opportunityId} />
                      <button type="submit" className="text-sm text-ink-soft underline hover:text-danger">
                        Decline this offer
                      </button>
                    </form>
                  </div>
                ) : hasActive ? (
                  <form action={withdrawApplicationAction} className="mt-3">
                    <input type="hidden" name="opportunityId" value={opportunityId} />
                    <button type="submit" className="text-sm text-ink-soft underline hover:text-danger">
                      Withdraw application
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
