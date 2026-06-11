import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  applications,
  opportunities,
  opportunityOccurrences,
  providerProfiles,
} from "@/db/schema";
import { SnapshotChips } from "@/components/SnapshotChips";
import { TermsBox } from "@/components/TermsBox";
import type { CredentialSnapshotChip } from "@/lib/credentials/requirements";
import { requireActiveOrg } from "@/lib/org";
import { declineApplicantAction, offerApplicantAction, shortlistApplicantAction } from "./actions";

export const metadata = { title: "Applicants" };

const STATUS_BADGE: Record<string, { text: string; tone: string }> = {
  submitted: { text: "New", tone: "bg-lilac/10 text-lilac" },
  viewed: { text: "Viewed", tone: "bg-lilac/10 text-lilac" },
  shortlisted: { text: "Shortlisted", tone: "bg-blush/30 text-blush-deep" },
  offered: { text: "Offer out", tone: "bg-success/10 text-success" },
  accepted: { text: "Booked", tone: "bg-success/10 text-success" },
  declined: { text: "Declined", tone: "bg-ink/5 text-ink-soft" },
  withdrawn: { text: "Withdrew", tone: "bg-ink/5 text-ink-soft" },
  expired: { text: "Closed", tone: "bg-ink/5 text-ink-soft" },
};

const SOURCE_LABEL: Record<string, string> = {
  watch_alert: "via watch-zone alert",
  search: "found it browsing",
  invite: "invited",
};

export default async function ApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ id }, { error, notice }, { contexts, org }] = await Promise.all([
    params,
    searchParams,
    requireActiveOrg(),
  ]);

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [opp] = await tx
      .select({
        id: opportunities.id,
        title: opportunities.title,
        status: opportunities.status,
        timezone: opportunities.timezone,
        slotCount: opportunities.slotCount,
      })
      .from(opportunities)
      .where(and(eq(opportunities.id, id), eq(opportunities.organizationId, org.id)));
    if (!opp) return null;
    const rows = await tx
      .select({
        id: applications.id,
        status: applications.status,
        scope: applications.scope,
        message: applications.message,
        source: applications.source,
        createdAt: applications.createdAt,
        credentialSnapshot: applications.credentialSnapshot,
        providerProfileId: providerProfiles.id,
        providerName: providerProfiles.displayName,
        yearsExperience: providerProfiles.yearsExperience,
        homeCity: providerProfiles.homeCity,
        homeState: providerProfiles.homeState,
        occurrenceStartsAt: opportunityOccurrences.startsAt,
      })
      .from(applications)
      .innerJoin(providerProfiles, eq(providerProfiles.id, applications.providerProfileId))
      .leftJoin(opportunityOccurrences, eq(opportunityOccurrences.id, applications.occurrenceId))
      .where(eq(applications.opportunityId, id))
      .orderBy(asc(applications.createdAt));
    return { opp, rows };
  });
  if (!data) notFound();
  const { opp, rows } = data;

  type Row = (typeof rows)[number];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(row.providerProfileId) ?? [];
    list.push(row);
    groups.set(row.providerProfileId, list);
  }

  const fmtDate = (date: Date) =>
    DateTime.fromJSDate(date, { zone: opp.timezone }).toFormat("EEE, MMM d · h:mm a");

  return (
    <div className="max-w-2xl">
      <p className="text-sm">
        <Link href={`/b/opportunities/${opp.id}`} className="text-ink-soft hover:text-lilac">
          ← {opp.title}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Applicants</h1>
      <p className="mt-2 text-ink-soft">
        Credential labels are frozen from the moment each provider applied — the same chips they
        saw. Names link to full profiles with documents and portfolios.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {groups.size === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          No applications yet. Matching providers were alerted when this posted — applications
          land here the moment they apply.
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {[...groups.entries()].map(([providerProfileId, group]) => {
            const first = group[0];
            const chips = (first.credentialSnapshot ?? []) as CredentialSnapshotChip[];
            const statuses = new Set(group.map((row) => row.status));
            const hasOffer = statuses.has("offered");
            const isBooked = statuses.has("accepted");
            const isActive = (["submitted", "viewed", "shortlisted"] as const).some((s) =>
              statuses.has(s),
            );
            const rollup = isBooked
              ? "accepted"
              : hasOffer
                ? "offered"
                : isActive
                  ? group.find((row) => row.status === "shortlisted")?.status ?? first.status
                  : first.status;
            const badge = STATUS_BADGE[rollup] ?? STATUS_BADGE.submitted;
            return (
              <div key={providerProfileId} className="oc-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link
                      href={`/b/providers/${providerProfileId}`}
                      className="font-semibold hover:text-lilac"
                    >
                      {first.providerName}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {first.homeCity ? `${first.homeCity}, ${first.homeState}` : null}
                      {first.yearsExperience != null
                        ? ` · ${first.yearsExperience} yrs experience`
                        : null}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.tone}`}>
                    {badge.text}
                  </span>
                </div>

                <p className="mt-2 text-xs text-ink-soft">
                  Applied {DateTime.fromJSDate(first.createdAt).toFormat("MMM d, h:mm a")}{" "}
                  {SOURCE_LABEL[first.source] ?? ""} · for{" "}
                  {group.some((row) => row.scope === "series")
                    ? "the whole series"
                    : `${group.length} date${group.length === 1 ? "" : "s"}`}
                </p>

                {group.some((row) => row.occurrenceStartsAt) ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {group.map((row) =>
                      row.occurrenceStartsAt ? (
                        <li key={row.id} className="flex items-center gap-2">
                          {fmtDate(row.occurrenceStartsAt)}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${(STATUS_BADGE[row.status] ?? STATUS_BADGE.submitted).tone}`}
                          >
                            {(STATUS_BADGE[row.status] ?? STATUS_BADGE.submitted).text}
                          </span>
                        </li>
                      ) : null,
                    )}
                  </ul>
                ) : null}

                {first.message ? (
                  <blockquote className="mt-3 rounded-lg bg-ink/5 p-3 text-sm">
                    {first.message}
                  </blockquote>
                ) : null}

                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Credentials (as of application)
                  </p>
                  <div className="mt-2">
                    <SnapshotChips chips={chips} />
                  </div>
                </div>

                {isBooked ? (
                  <p className="mt-4 text-sm">
                    Booked —{" "}
                    <Link href="/b/bookings" className="underline hover:text-lilac">
                      see bookings
                    </Link>
                    .
                  </p>
                ) : hasOffer ? (
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <p className="text-sm text-ink-soft">
                      Offer sent — waiting on the provider&apos;s confirmation.
                    </p>
                    <form action={declineApplicantAction}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="opportunityId" value={opp.id} />
                      <input type="hidden" name="providerProfileId" value={providerProfileId} />
                      <button
                        type="submit"
                        className="text-sm text-ink-soft underline hover:text-danger"
                      >
                        Retract offer
                      </button>
                    </form>
                  </div>
                ) : isActive ? (
                  <div className="mt-4 space-y-3">
                    <details className="rounded-lg border border-line p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Select {first.providerName} {opp.slotCount > 1 ? "(fills one slot)" : ""}
                      </summary>
                      <form action={offerApplicantAction} className="mt-3 space-y-3">
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="providerProfileId" value={providerProfileId} />
                        <TermsBox />
                        <button type="submit" className="oc-btn">
                          Send offer
                        </button>
                        <p className="text-xs text-ink-soft">
                          The booking is confirmed once they accept — you&apos;ll both get contact
                          details then.
                        </p>
                      </form>
                    </details>
                    <div className="flex gap-4">
                      {!statuses.has("shortlisted") ? (
                        <form action={shortlistApplicantAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="opportunityId" value={opp.id} />
                          <input type="hidden" name="providerProfileId" value={providerProfileId} />
                          <button type="submit" className="text-sm underline hover:text-lilac">
                            Shortlist
                          </button>
                        </form>
                      ) : null}
                      <form action={declineApplicantAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="providerProfileId" value={providerProfileId} />
                        <button
                          type="submit"
                          className="text-sm text-ink-soft underline hover:text-danger"
                        >
                          Decline
                        </button>
                      </form>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
