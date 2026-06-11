import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { and, asc, eq, gt } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
} from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import { opportunityTypeMeta } from "@/lib/opportunity-types";
import { updateOpportunityAction } from "../../actions";
import { OpportunityFormFields } from "../../OpportunityFormFields";
import { loadTaxonomy } from "../../taxonomy";

export const metadata = { title: "Edit opportunity" };

export default async function EditOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }, { contexts, org }] = await Promise.all([
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
    const taxonomy = await loadTaxonomy(tx, org.id);
    const serviceRows = await tx
      .select({ id: opportunityServices.serviceId })
      .from(opportunityServices)
      .where(eq(opportunityServices.opportunityId, id));
    const typeRows = await tx
      .select({ id: opportunityProviderTypes.providerTypeId })
      .from(opportunityProviderTypes)
      .where(eq(opportunityProviderTypes.opportunityId, id));
    const [nextOccurrence] = await tx
      .select()
      .from(opportunityOccurrences)
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, id),
          eq(opportunityOccurrences.status, "open"),
          gt(opportunityOccurrences.startsAt, new Date()),
        ),
      )
      .orderBy(asc(opportunityOccurrences.startsAt))
      .limit(1);
    return { opp, taxonomy, serviceRows, typeRows, nextOccurrence };
  });
  if (!data) notFound();
  const { opp, taxonomy, serviceRows, typeRows, nextOccurrence } = data;

  if (opp.status !== "draft" && opp.status !== "posted") {
    redirect(`/b/opportunities/${id}?error=` + encodeURIComponent("Only drafts and posted opportunities can be edited."));
  }
  const meta = opportunityTypeMeta(opp.type);
  if (!meta) notFound();

  const occurrenceDefaults =
    meta.schedule === "one_time" && nextOccurrence
      ? {
          date: DateTime.fromJSDate(nextOccurrence.startsAt, { zone: opp.timezone }).toFormat("yyyy-MM-dd"),
          startTime: DateTime.fromJSDate(nextOccurrence.startsAt, { zone: opp.timezone }).toFormat("HH:mm"),
          endTime: DateTime.fromJSDate(nextOccurrence.endsAt, { zone: opp.timezone }).toFormat("HH:mm"),
        }
      : undefined;

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-ink-soft">
        <Link href={`/b/opportunities/${id}`} className="hover:text-lilac">
          ← Back to opportunity
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Edit: {opp.title}</h1>
      <p className="mt-2 text-ink-soft">
        Schedule changes regenerate the upcoming open dates. The type can&apos;t change.
      </p>

      <form action={updateOpportunityAction} className="mt-8 space-y-6">
        <input type="hidden" name="organizationId" value={org.id} />
        <input type="hidden" name="opportunityId" value={opp.id} />
        <input type="hidden" name="type" value={opp.type} />
        <OpportunityFormFields
          meta={meta}
          taxonomy={taxonomy}
          opportunity={opp}
          selectedServiceIds={new Set(serviceRows.map((r) => r.id))}
          selectedProviderTypeIds={new Set(typeRows.map((r) => r.id))}
          occurrenceDefaults={occurrenceDefaults}
        />
        {error ? <p className="oc-error">{error}</p> : null}
        <button type="submit" className="oc-btn">
          Save changes
        </button>
      </form>
    </div>
  );
}
