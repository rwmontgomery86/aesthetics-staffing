import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, asc, eq, gt } from "drizzle-orm";
import { dbAsAnon } from "@/db/client";
import {
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  organizations,
  providerTypes,
  services,
} from "@/db/schema";
import { formatPay, opportunityTypeLabel } from "@/lib/opportunity-types";

export const metadata = { title: "Opportunity" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The public detail page. Rendered through the ANON database path on purpose:
 * RLS only shows status='posted' rows to anon, so drafts, canceled, and
 * expired posts 404 here structurally — not by an if-statement we could get
 * wrong. Visible to signed-out providers and search engines alike.
 */
export default async function PublicOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const data = await dbAsAnon(async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id));
    if (!opp) return null;
    const [org] = await tx
      .select({ name: organizations.name, kind: organizations.kind, logoPath: organizations.logoPath, description: organizations.description })
      .from(organizations)
      .where(eq(organizations.id, opp.organizationId));
    const [location] = await tx
      .select()
      .from(locations)
      .where(eq(locations.id, opp.locationId));
    const oppServices = await tx
      .select({ name: services.name })
      .from(opportunityServices)
      .innerJoin(services, eq(services.id, opportunityServices.serviceId))
      .where(eq(opportunityServices.opportunityId, id));
    const oppProviderTypes = await tx
      .select({ name: providerTypes.name })
      .from(opportunityProviderTypes)
      .innerJoin(providerTypes, eq(providerTypes.id, opportunityProviderTypes.providerTypeId))
      .where(eq(opportunityProviderTypes.opportunityId, id));
    const upcoming = await tx
      .select()
      .from(opportunityOccurrences)
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, id),
          eq(opportunityOccurrences.status, "open"),
          gt(opportunityOccurrences.startsAt, new Date()),
        ),
      )
      .orderBy(asc(opportunityOccurrences.startsAt));
    return { opp, org, location, oppServices, oppProviderTypes, upcoming };
  });
  if (!data) notFound();
  const { opp, org, location, oppServices, oppProviderTypes, upcoming } = data;

  const pay = formatPay(opp);
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: opp.timezone }).toFormat("EEE, MMM d · h:mm a");
  const fmtTime = (d: Date) => DateTime.fromJSDate(d, { zone: opp.timezone }).toFormat("h:mm a");
  const deadlinePassed = opp.applicationDeadline != null && opp.applicationDeadline < new Date();
  const logoUrl =
    org?.logoPath && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-media/${org.logoPath}`
      : null;
  const shownDates = upcoming.slice(0, 8);

  return (
    <article>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // Plain <img>: a public-bucket URL — next/image remotePatterns config can wait for the SEO phase.
          <img src={logoUrl} alt="" className="h-14 w-14 rounded-xl border border-line object-cover" />
        ) : null}
        <div>
          <p className="text-sm font-medium text-lilac">{org?.name}</p>
          <h1 className="text-3xl font-semibold">{opp.title}</h1>
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-ink-soft">
        <span>{opportunityTypeLabel(opp.type)}</span>
        {opp.urgent ? (
          <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">urgent</span>
        ) : null}
        {location ? (
          <span>
            · {location.name}, {location.city}, {location.state}
          </span>
        ) : null}
      </p>

      <div className="oc-card mt-6 grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Pay</p>
          <p className="mt-1 font-semibold">{pay ?? "Discussed in conversation"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Looking for</p>
          <p className="mt-1 font-semibold">{oppProviderTypes.map((t) => t.name).join(", ") || "—"}</p>
        </div>
        {location ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Where</p>
            <p className="mt-1 text-sm">
              {location.addressLine1}
              {location.addressLine2 ? `, ${location.addressLine2}` : ""}
              <br />
              {location.city}, {location.state} {location.zip}
            </p>
          </div>
        ) : null}
        {opp.applicationDeadline ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Apply by</p>
            <p className="mt-1 text-sm">{fmt(opp.applicationDeadline)}</p>
          </div>
        ) : null}
      </div>

      {shownDates.length > 0 ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">Dates</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {shownDates.map((occ) => (
              <li key={occ.id}>
                {fmt(occ.startsAt)} – {fmtTime(occ.endsAt)}
              </li>
            ))}
          </ul>
          {upcoming.length > shownDates.length ? (
            <p className="mt-2 text-sm text-ink-soft">+ {upcoming.length - shownDates.length} more dates</p>
          ) : null}
        </section>
      ) : null}

      {opp.description ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">About this opportunity</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{opp.description}</p>
        </section>
      ) : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="inline text-ink-soft">Services: </dt>
            <dd className="inline">{oppServices.map((s) => s.name).join(", ") || "—"}</dd>
          </div>
          {opp.expectedVolume ? (
            <div>
              <dt className="inline text-ink-soft">Expected volume: </dt>
              <dd className="inline">{opp.expectedVolume}</dd>
            </div>
          ) : null}
          {location?.supervisionContext ? (
            <div>
              <dt className="inline text-ink-soft">Supervision context: </dt>
              <dd className="inline">{location.supervisionContext}</dd>
            </div>
          ) : null}
          {opp.liabilityExpectations ? (
            <div>
              <dt className="inline text-ink-soft">Liability expectations: </dt>
              <dd className="inline">{opp.liabilityExpectations}</dd>
            </div>
          ) : null}
          {location?.dressCode ? (
            <div>
              <dt className="inline text-ink-soft">Dress code: </dt>
              <dd className="inline">{location.dressCode}</dd>
            </div>
          ) : null}
          {location?.parkingNotes ? (
            <div>
              <dt className="inline text-ink-soft">Parking: </dt>
              <dd className="inline">{location.parkingNotes}</dd>
            </div>
          ) : null}
          {opp.notes ? (
            <div>
              <dt className="inline text-ink-soft">Notes: </dt>
              <dd className="inline">{opp.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="oc-card mt-6 p-6 text-center">
        {deadlinePassed ? (
          <p className="font-medium text-ink-soft">Applications for this opportunity have closed.</p>
        ) : (
          <>
            <p className="font-medium">Interested?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Create a provider account and draw a watch zone — you&apos;ll be alerted the moment
              work like this posts. In-app applications open in an upcoming release.
            </p>
            <Link href={`/signup?next=${encodeURIComponent(`/o/${opp.id}`)}`} className="oc-btn mt-4 inline-block">
              Join as a provider
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
