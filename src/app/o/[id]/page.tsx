import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, asc, eq, gt } from "drizzle-orm";
import { dbAs, dbAsAnon } from "@/db/client";
import {
  applications,
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  organizationMembers,
  organizations,
  providerProfiles,
  providerTypes,
  services,
} from "@/db/schema";
import { SnapshotChips } from "@/components/SnapshotChips";
import { getAuthUser } from "@/lib/auth/session";
import {
  getOpportunityCredentialChips,
  type CredentialSnapshotChip,
} from "@/lib/credentials/requirements";
import { formatPay, opportunityTypeLabel } from "@/lib/opportunity-types";
import { ApplyForm } from "./ApplyForm";

export const metadata = { title: "Opportunity" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The public detail page. Rendered through the ANON database path on purpose:
 * RLS only shows status='posted' rows to anon, so drafts, canceled, and
 * expired posts 404 here structurally — not by an if-statement we could get
 * wrong. Visible to signed-out providers and search engines alike.
 */
export default async function PublicOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ id }, { error, notice }] = await Promise.all([params, searchParams]);
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
      .select({ id: services.id, name: services.name })
      .from(opportunityServices)
      .innerJoin(services, eq(services.id, opportunityServices.serviceId))
      .where(eq(opportunityServices.opportunityId, id));
    const oppProviderTypes = await tx
      .select({ id: providerTypes.id, name: providerTypes.name })
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

  // The viewer's relationship to this post (RLS-scoped): a provider gets the
  // apply box with their own credential chips; the posting org gets a manage
  // link; everyone else gets the join CTA.
  const user = await getAuthUser();
  let viewer: {
    isOrgMember: boolean;
    hasProviderProfile: boolean;
    myApplications: { status: string }[];
    chips: CredentialSnapshotChip[];
  } | null = null;
  if (user) {
    viewer = await dbAs(user, async (tx) => {
      const [membership] = await tx
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, opp.organizationId),
            eq(organizationMembers.userId, user.id),
          ),
        );
      const [provider] = await tx
        .select({ id: providerProfiles.id })
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, user.id));
      if (!provider) {
        return {
          isOrgMember: Boolean(membership),
          hasProviderProfile: false,
          myApplications: [],
          chips: [],
        };
      }
      const myApplications = await tx
        .select({ status: applications.status })
        .from(applications)
        .where(
          and(eq(applications.opportunityId, id), eq(applications.providerProfileId, provider.id)),
        );
      const chips = await getOpportunityCredentialChips(
        tx,
        provider.id,
        {
          serviceIds: oppServices.map((s) => s.id),
          providerTypeIds: oppProviderTypes.map((t) => t.id),
        },
        location?.state ?? "GA",
      );
      return {
        isOrgMember: Boolean(membership),
        hasProviderProfile: true,
        myApplications,
        chips,
      };
    });
  }

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

      <div className="oc-card mt-6 p-6">
        {error ? <p className="oc-error mb-4">{error}</p> : null}
        {notice ? <p className="oc-notice mb-4">{notice}</p> : null}
        {deadlinePassed ? (
          <p className="text-center font-medium text-ink-soft">
            Applications for this opportunity have closed.
          </p>
        ) : viewer?.isOrgMember ? (
          <p className="text-center text-sm text-ink-soft">
            This is your team&apos;s posting.{" "}
            <Link href={`/b/opportunities/${opp.id}`} className="underline hover:text-lilac">
              Manage it here
            </Link>
            .
          </p>
        ) : viewer && viewer.myApplications.length > 0 ? (
          <div className="text-center">
            <p className="font-medium">You&apos;ve applied to this opportunity.</p>
            <Link href="/p/applications" className="oc-btn-secondary mt-4 inline-block">
              Track it in My applications
            </Link>
          </div>
        ) : viewer?.hasProviderProfile ? (
          <div>
            <h2 className="text-lg font-semibold">Apply</h2>
            {viewer.chips.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  How your credentials line up
                </p>
                <div className="mt-2">
                  <SnapshotChips chips={viewer.chips} />
                </div>
                {viewer.chips.some((chip) => chip.isWarning) ? (
                  <p className="oc-error mt-3">
                    Some required credentials are missing or expired. You can still apply — the
                    business will see these same labels.{" "}
                    <Link href="/p/credentials" className="underline">
                      Update credentials
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}
            <ApplyForm
              opportunityId={opp.id}
              dates={upcoming.map((occ) => ({
                id: occ.id,
                label: `${fmt(occ.startsAt)} – ${fmtTime(occ.endsAt)}`,
              }))}
            />
          </div>
        ) : user ? (
          <div className="text-center">
            <p className="font-medium">Interested?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Add the provider side to your account to apply.
            </p>
            <Link href="/onboarding" className="oc-btn mt-4 inline-block">
              Set up your provider profile
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-medium">Interested?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Create a provider account to apply — and draw a watch zone so you&apos;re alerted the
              moment work like this posts.
            </p>
            <Link href={`/signup?next=${encodeURIComponent(`/o/${opp.id}`)}`} className="oc-btn mt-4 inline-block">
              Join as a provider
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}
