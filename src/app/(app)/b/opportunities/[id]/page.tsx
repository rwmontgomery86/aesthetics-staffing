import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, asc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  applications,
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  providerTypes,
  services,
} from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import { estimateReach } from "@/lib/matching/reach";
import {
  OPPORTUNITY_STATUS_LABELS,
  formatPay,
  opportunityTypeLabel,
  opportunityTypeMeta,
} from "@/lib/opportunity-types";
import {
  cancelOccurrenceAction,
  cancelOpportunityAction,
  postOpportunityAction,
  rescheduleOccurrenceAction,
} from "../actions";

export const metadata = { title: "Opportunity" };

export default async function ManageOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, { notice, error }, { contexts, org }] = await Promise.all([
    params,
    searchParams,
    requireActiveOrg(),
  ]);

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), eq(opportunities.organizationId, org.id)));
    if (!opp) return null;
    const [location] = await tx
      .select({
        name: locations.name,
        city: locations.city,
        lat: sql<number | null>`st_y(${locations.geog}::geometry)`,
        lng: sql<number | null>`st_x(${locations.geog}::geometry)`,
      })
      .from(locations)
      .where(eq(locations.id, opp.locationId));
    const oppServices = await tx
      .select({ id: services.id, name: services.name })
      .from(opportunityServices)
      .innerJoin(services, eq(services.id, opportunityServices.serviceId))
      .where(eq(opportunityServices.opportunityId, id));
    const oppProviderTypes = await tx
      .select({ id: providerTypes.id, name: providerTypes.name })
      .from(opportunityProviderTypes)
      .innerJoin(providerTypes, eq(providerTypes.id, opportunityProviderTypes.providerTypeId))
      .where(eq(opportunityProviderTypes.opportunityId, id));
    const occurrences = await tx
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.opportunityId, id))
      .orderBy(asc(opportunityOccurrences.startsAt));
    const applicationRows = await tx
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.opportunityId, id));
    return { opp, location, oppServices, oppProviderTypes, occurrences, applicationRows };
  });
  if (!data) notFound();
  const { opp, location, oppServices, oppProviderTypes, occurrences, applicationRows } = data;
  const pendingApplications = applicationRows.filter((row) =>
    ["submitted", "viewed", "shortlisted", "offered"].includes(row.status),
  ).length;

  // The reach estimate (aggregate only) is recomputed on render for drafts and
  // posted opportunities — the number a poster sees before/after going live.
  const reach =
    (opp.status === "draft" || opp.status === "posted") && location?.lat != null && location.lng != null
      ? await estimateReach({
          lat: location.lat,
          lng: location.lng,
          opportunityType: opp.type,
          serviceIds: oppServices.map((s) => s.id),
          providerTypeIds: oppProviderTypes.map((t) => t.id),
          organizationId: org.id,
          urgent: opp.urgent,
          payMinCents: opp.payMinCents,
          payMaxCents: opp.payMaxCents,
          payUnit: opp.payUnit,
        })
      : null;

  const now = new Date();
  const upcoming = occurrences.filter((o) => o.startsAt > now);
  const past = occurrences.length - upcoming.length;
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: opp.timezone }).toFormat("EEE, MMM d · h:mm a");
  const fmtTime = (d: Date) => DateTime.fromJSDate(d, { zone: opp.timezone }).toFormat("h:mm a");
  const pay = formatPay(opp);
  const meta = opportunityTypeMeta(opp.type);
  const canEdit = opp.status === "draft" || opp.status === "posted";

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-ink-soft">
        <Link href="/b/opportunities" className="hover:text-lilac">
          ← All opportunities
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{opp.title}</h1>
        <span className="rounded-full bg-ink/10 px-2.5 py-1 text-xs font-medium">
          {OPPORTUNITY_STATUS_LABELS[opp.status]}
        </span>
        {opp.urgent ? (
          <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">urgent</span>
        ) : null}
      </div>
      <p className="mt-2 text-ink-soft">
        {opportunityTypeLabel(opp.type)} · {location?.name} ({location?.city})
        {pay ? ` · ${pay}` : " · pay not shown"}
      </p>

      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      {reach != null ? (
        <div className="oc-card mt-6 border-lilac-soft p-4">
          <p className="font-medium">~{reach} provider{reach === 1 ? "" : "s"} watching this area</p>
          <p className="mt-1 text-sm text-ink-soft">
            Providers whose watch zones cover this location and whose filters this post passes.
            {opp.status === "draft" ? " They're alerted the moment you post." : " They were alerted when this posted."}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {applicationRows.length > 0 ? (
          <Link href={`/b/opportunities/${opp.id}/applicants`} className="oc-btn">
            Applicants ({pendingApplications} pending)
          </Link>
        ) : null}
        {opp.status === "draft" || opp.status === "expired" ? (
          <form action={postOpportunityAction}>
            <input type="hidden" name="organizationId" value={org.id} />
            <input type="hidden" name="opportunityId" value={opp.id} />
            <button type="submit" className="oc-btn">
              Post {opp.status === "expired" ? "again" : "now"}
            </button>
          </form>
        ) : null}
        {canEdit ? (
          <Link href={`/b/opportunities/${opp.id}/edit`} className="oc-btn-secondary">
            Edit
          </Link>
        ) : null}
        {opp.status === "posted" ? (
          <a href={`/o/${opp.id}`} target="_blank" rel="noreferrer" className="oc-btn-secondary">
            View public page ↗
          </a>
        ) : null}
        {opp.status !== "canceled" && opp.status !== "archived" ? (
          <form action={cancelOpportunityAction}>
            <input type="hidden" name="organizationId" value={org.id} />
            <input type="hidden" name="opportunityId" value={opp.id} />
            <button type="submit" className="oc-btn-ghost text-danger">
              Cancel opportunity
            </button>
          </form>
        ) : null}
      </div>

      {opp.description ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{opp.description}</p>
        </section>
      ) : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Who &amp; what</h2>
        <p className="mt-2 text-sm">
          <span className="text-ink-soft">Provider types:</span>{" "}
          {oppProviderTypes.map((t) => t.name).join(", ") || "—"}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-ink-soft">Services:</span>{" "}
          {oppServices.map((s) => s.name).join(", ") || "—"}
        </p>
        {opp.applicationDeadline ? (
          <p className="mt-1 text-sm">
            <span className="text-ink-soft">Application deadline:</span> {fmt(opp.applicationDeadline)}
          </p>
        ) : null}
        {opp.expiresAt ? (
          <p className="mt-1 text-sm">
            <span className="text-ink-soft">Auto-expires:</span> {fmt(opp.expiresAt)}
          </p>
        ) : null}
      </section>

      {meta?.schedule !== "none" ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">
            Dates{" "}
            <span className="text-sm font-normal text-ink-soft">
              ({upcoming.length} upcoming{past > 0 ? `, ${past} past` : ""}, times in {opp.timezone})
            </span>
          </h2>
          <div className="mt-3 space-y-2">
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-soft">No upcoming dates.</p>
            ) : (
              upcoming.map((occ) => (
                <div key={occ.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    {fmt(occ.startsAt)} – {fmtTime(occ.endsAt)}
                    {occ.rescheduledFromId ? (
                      <span className="ml-2 rounded-full bg-lilac/10 px-2 py-0.5 text-xs text-lilac">rescheduled</span>
                    ) : null}
                  </span>
                  {occ.status !== "open" ? (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs capitalize text-ink-soft">{occ.status}</span>
                  ) : (
                    <>
                      <details className="relative">
                        <summary className="cursor-pointer select-none text-lilac hover:underline">Reschedule</summary>
                        <form
                          action={rescheduleOccurrenceAction}
                          className="absolute right-0 z-10 mt-2 w-72 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card"
                        >
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="opportunityId" value={opp.id} />
                          <input type="hidden" name="occurrenceId" value={occ.id} />
                          <input
                            type="date"
                            name="date"
                            required
                            defaultValue={DateTime.fromJSDate(occ.startsAt, { zone: opp.timezone }).toFormat("yyyy-MM-dd")}
                            className="oc-input"
                          />
                          <div className="flex gap-2">
                            <input
                              type="time"
                              name="startTime"
                              required
                              defaultValue={DateTime.fromJSDate(occ.startsAt, { zone: opp.timezone }).toFormat("HH:mm")}
                              className="oc-input"
                            />
                            <input
                              type="time"
                              name="endTime"
                              required
                              defaultValue={DateTime.fromJSDate(occ.endsAt, { zone: opp.timezone }).toFormat("HH:mm")}
                              className="oc-input"
                            />
                          </div>
                          <button type="submit" className="oc-btn w-full text-sm">
                            Move this date
                          </button>
                        </form>
                      </details>
                      <form action={cancelOccurrenceAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="occurrenceId" value={occ.id} />
                        <button type="submit" className="text-danger hover:underline">
                          Cancel date
                        </button>
                      </form>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
