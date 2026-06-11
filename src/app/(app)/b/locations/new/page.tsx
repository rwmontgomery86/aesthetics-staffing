import { requireActiveOrg } from "@/lib/org";
import { createLocationAction } from "../actions";
import { LocationFormFields } from "../LocationFormFields";

export const metadata = { title: "Add location" };

export default async function NewLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { org }] = await Promise.all([searchParams, requireActiveOrg("admin")]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Add a location</h1>
      <p className="mt-2 text-ink-soft">
        We&apos;ll place it on the map from the address — that pin is what providers&apos; watch
        zones match against.
      </p>

      <form action={createLocationAction} className="oc-card mt-8 space-y-5 p-6">
        <input type="hidden" name="organizationId" value={org.id} />
        <LocationFormFields />
        {error ? <p className="oc-error">{error}</p> : null}
        <button type="submit" className="oc-btn">
          Save location
        </button>
      </form>
    </div>
  );
}
