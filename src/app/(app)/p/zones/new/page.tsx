import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { geoCities, providerServices, services } from "@/db/schema";
import { ZoneGeometryEditor } from "@/components/zone-editor/ZoneGeometryEditor";
import { requireProviderRow } from "@/lib/provider";
import { createZoneAction } from "../actions";
import { EMPTY_FILTER_DEFAULTS, ZoneFilterFields } from "../ZoneFilterFields";

export const metadata = { title: "New watch zone" };

export default async function NewZonePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { user, provider }] = await Promise.all([searchParams, requireProviderRow()]);

  const data = await dbAs(user, async (tx) => ({
    cities: await tx
      .select({ geoid: geoCities.geoid, name: geoCities.name })
      .from(geoCities)
      .orderBy(asc(geoCities.name)),
    myServices: await tx
      .select({ id: services.id, name: services.name })
      .from(providerServices)
      .innerJoin(services, eq(services.id, providerServices.serviceId))
      .where(eq(providerServices.providerProfileId, provider.id)),
    smsReady: false, // phone verification + SMS sending arrive in Phase 6
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">New watch zone</h1>
      <p className="mt-2 text-ink-soft">
        Define an area and what you want to hear about there. You can make as many zones as you
        like — each with its own filters.
      </p>

      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <form action={createZoneAction} className="mt-8 space-y-8">
        <div className="oc-card space-y-6 p-6">
          <div className="max-w-sm">
            <label className="oc-label">Zone name</label>
            <input name="name" required minLength={2} placeholder="e.g. Metro Atlanta" className="oc-input" />
          </div>
          <ZoneGeometryEditor cities={data.cities} />
        </div>

        <div className="oc-card space-y-6 p-6">
          <ZoneFilterFields
            defaults={EMPTY_FILTER_DEFAULTS}
            myServices={data.myServices}
            smsAvailable={data.smsReady}
          />
        </div>

        <button type="submit" className="oc-btn">
          Create watch zone
        </button>
      </form>
    </div>
  );
}
