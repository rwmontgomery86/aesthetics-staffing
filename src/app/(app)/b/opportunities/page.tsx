import Link from "next/link";
import { DateTime } from "luxon";
import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { locations, opportunities, opportunityOccurrences } from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import {
  OPPORTUNITY_STATUS_LABELS,
  formatPay,
  opportunityTypeLabel,
} from "@/lib/opportunity-types";

export const metadata = { title: "Opportunities" };

const FILTERS = ["all", "draft", "posted", "filled", "expired", "canceled"] as const;

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-ink/10 text-ink-soft",
  posted: "bg-success/15 text-success",
  filled: "bg-lilac/15 text-lilac",
  expired: "bg-ink/10 text-ink-soft",
  canceled: "bg-danger/10 text-danger",
  archived: "bg-ink/10 text-ink-soft",
};

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; error?: string }>;
}) {
  const [{ status, notice, error }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg(),
  ]);
  const filter = FILTERS.includes(status as (typeof FILTERS)[number]) ? (status as string) : "all";

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const opps = await tx
      .select({
        id: opportunities.id,
        type: opportunities.type,
        title: opportunities.title,
        status: opportunities.status,
        urgent: opportunities.urgent,
        payKind: opportunities.payKind,
        payUnit: opportunities.payUnit,
        payMinCents: opportunities.payMinCents,
        payMaxCents: opportunities.payMaxCents,
        timezone: opportunities.timezone,
        createdAt: opportunities.createdAt,
        locationName: locations.name,
      })
      .from(opportunities)
      .innerJoin(locations, eq(locations.id, opportunities.locationId))
      .where(
        and(
          eq(opportunities.organizationId, org.id),
          filter === "all" ? undefined : eq(opportunities.status, filter as never),
        ),
      )
      .orderBy(desc(opportunities.createdAt));

    const ids = opps.map((o) => o.id);
    const nextOccurrences = ids.length
      ? await tx
          .select({
            opportunityId: opportunityOccurrences.opportunityId,
            startsAt: opportunityOccurrences.startsAt,
            total: count(),
          })
          .from(opportunityOccurrences)
          .where(
            and(
              inArray(opportunityOccurrences.opportunityId, ids),
              eq(opportunityOccurrences.status, "open"),
              gt(opportunityOccurrences.startsAt, new Date()),
            ),
          )
          .groupBy(opportunityOccurrences.opportunityId, opportunityOccurrences.startsAt)
          .orderBy(asc(opportunityOccurrences.startsAt))
      : [];
    const nextByOpp = new Map<string, { startsAt: Date; total: number }>();
    for (const row of nextOccurrences) {
      const existing = nextByOpp.get(row.opportunityId);
      if (existing) existing.total += 1;
      else nextByOpp.set(row.opportunityId, { startsAt: row.startsAt, total: 1 });
    }
    return { opps, nextByOpp };
  });

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Opportunities</h1>
          <p className="mt-2 text-ink-soft">Shifts, roles, and events you&apos;ve posted.</p>
        </div>
        <Link href="/b/opportunities/new" className="oc-btn shrink-0">
          New opportunity
        </Link>
      </div>

      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/b/opportunities" : `/b/opportunities?status=${f}`}
            className={`rounded-full border px-3 py-1 text-sm capitalize ${
              filter === f ? "border-lilac bg-lilac/10 font-medium text-lilac" : "border-line text-ink-soft hover:border-lilac-soft"
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {rows.opps.length === 0 ? (
          <div className="oc-card p-6 text-center">
            <p className="font-medium">Nothing here yet</p>
            <p className="mt-1 text-sm text-ink-soft">
              Post your first opportunity — matching providers get alerted the moment delivery
              launches.
            </p>
          </div>
        ) : (
          rows.opps.map((opp) => {
            const next = rows.nextByOpp.get(opp.id);
            const pay = formatPay(opp);
            return (
              <Link
                key={opp.id}
                href={`/b/opportunities/${opp.id}`}
                className="oc-card block p-4 transition-colors hover:border-lilac-soft"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{opp.title}</span>
                  {opp.urgent ? (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">urgent</span>
                  ) : null}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[opp.status]}`}>
                    {OPPORTUNITY_STATUS_LABELS[opp.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {opportunityTypeLabel(opp.type)} · {opp.locationName}
                  {pay ? ` · ${pay}` : ""}
                  {next
                    ? ` · next ${DateTime.fromJSDate(next.startsAt, { zone: opp.timezone }).toFormat("EEE MMM d, h:mm a")} (${next.total} upcoming)`
                    : ""}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
