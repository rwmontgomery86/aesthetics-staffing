import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { locations } from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import { updateLocationAction } from "../actions";
import { LocationFormFields } from "../LocationFormFields";

export const metadata = { title: "Edit location" };

export default async function EditLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }, { contexts, org }] = await Promise.all([
    params,
    searchParams,
    requireActiveOrg("admin"),
  ]);

  const [location] = await dbAs({ id: contexts.user.id, email: contexts.user.email }, (tx) =>
    tx
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), eq(locations.organizationId, org.id))),
  );
  if (!location) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">{location.name}</h1>
      <p className="mt-2 text-ink-soft">
        Saving re-places the map pin if the address changed.
      </p>

      <form action={updateLocationAction} className="oc-card mt-8 space-y-5 p-6">
        <input type="hidden" name="organizationId" value={org.id} />
        <input type="hidden" name="locationId" value={location.id} />
        <LocationFormFields location={location} />

        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
          <input type="checkbox" name="active" defaultChecked={location.active} className="mt-0.5" />
          <span>
            <span className="font-medium">Active location.</span>{" "}
            <span className="text-ink-soft">
              Inactive locations are kept on file but won&apos;t be offered when posting
              opportunities.
            </span>
          </span>
        </label>

        {error ? <p className="oc-error">{error}</p> : null}
        <button type="submit" className="oc-btn">
          Save location
        </button>
      </form>
    </div>
  );
}
