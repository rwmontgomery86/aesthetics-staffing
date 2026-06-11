import Link from "next/link";
import { dbAs } from "@/db/client";
import { requireActiveOrg } from "@/lib/org";
import { OPPORTUNITY_TYPES, opportunityTypeMeta } from "@/lib/opportunity-types";
import { createOpportunityAction } from "../actions";
import { OpportunityFormFields } from "../OpportunityFormFields";
import { loadTaxonomy } from "../taxonomy";

export const metadata = { title: "New opportunity" };

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; error?: string }>;
}) {
  const [{ type, error }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg(), // any member ≥ poster can post; requireOrgRole is in the action
  ]);

  const meta = type ? opportunityTypeMeta(type) : undefined;

  if (!meta || meta.comingSoon) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold">What do you need?</h1>
        <p className="mt-2 text-ink-soft">
          Pick the shape of the work — it decides the schedule and pay fields.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {OPPORTUNITY_TYPES.map((t) =>
            t.comingSoon ? (
              <div key={t.value} className="oc-card p-4 opacity-60">
                <p className="font-medium">{t.label}</p>
                <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-lilac">Coming soon</p>
              </div>
            ) : (
              <Link
                key={t.value}
                href={`/b/opportunities/new?type=${t.value}`}
                className="oc-card p-4 transition-colors hover:border-lilac-soft"
              >
                <p className="font-medium">{t.label}</p>
                <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  const taxonomy = await dbAs({ id: contexts.user.id, email: contexts.user.email }, (tx) =>
    loadTaxonomy(tx, org.id),
  );

  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium uppercase tracking-wide text-lilac">{meta.label}</p>
      <h1 className="mt-1 text-3xl font-semibold">New opportunity</h1>
      <p className="mt-2 text-ink-soft">{meta.description}</p>
      {taxonomy.locations.length === 0 ? (
        <p className="oc-error mt-6">
          Add a <Link href="/b/locations/new" className="underline">location</Link> first — opportunities are matched from its map pin.
        </p>
      ) : (
        <form action={createOpportunityAction} className="mt-8 space-y-6">
          <input type="hidden" name="organizationId" value={org.id} />
          <input type="hidden" name="type" value={meta.value} />
          <OpportunityFormFields meta={meta} taxonomy={taxonomy} />
          {error ? <p className="oc-error">{error}</p> : null}
          <div className="flex gap-3">
            <button type="submit" name="intent" value="post" className="oc-btn">
              Post now
            </button>
            <button type="submit" name="intent" value="draft" className="oc-btn-secondary">
              Save as draft
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
