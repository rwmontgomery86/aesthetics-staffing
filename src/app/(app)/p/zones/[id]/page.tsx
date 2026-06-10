import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { geoCities, providerServices, services, watchZones } from "@/db/schema";
import {
  ZoneGeometryEditor,
  type ZoneGeometryDefaults,
} from "@/components/zone-editor/ZoneGeometryEditor";
import { requireProviderRow } from "@/lib/provider";
import { updateZoneAction } from "../actions";
import { ZoneFilterFields, type ZoneFilterDefaults } from "../ZoneFilterFields";

export const metadata = { title: "Edit watch zone" };

function metaToDefaults(meta: unknown): ZoneGeometryDefaults {
  const data = (meta ?? {}) as Record<string, unknown>;
  switch (data.kind) {
    case "radius":
      return {
        kind: "radius",
        center: { lat: Number(data.centerLat), lng: Number(data.centerLng) },
        radiusMeters: Number(data.radiusMeters),
      };
    case "polygon":
      return { kind: "polygon", points: (data.points as Array<{ lat: number; lng: number }>) ?? [] };
    case "city":
      return { kind: "city", cityGeoid: String(data.placeGeoid ?? "") };
    case "zip":
      return { kind: "zip", zip: String(data.zip ?? "") };
    default:
      return { kind: "radius" };
  }
}

export default async function EditZonePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }, { user, provider }] = await Promise.all([
    params,
    searchParams,
    requireProviderRow(),
  ]);

  const data = await dbAs(user, async (tx) => {
    const [zone] = await tx
      .select()
      .from(watchZones)
      .where(and(eq(watchZones.id, id), eq(watchZones.providerProfileId, provider.id)));
    if (!zone) return null;
    return {
      zone,
      cities: await tx
        .select({ geoid: geoCities.geoid, name: geoCities.name })
        .from(geoCities)
        .orderBy(asc(geoCities.name)),
      myServices: await tx
        .select({ id: services.id, name: services.name })
        .from(providerServices)
        .innerJoin(services, eq(services.id, providerServices.serviceId))
        .where(eq(providerServices.providerProfileId, provider.id)),
    };
  });
  if (!data) notFound();
  const { zone } = data;

  const filterDefaults: ZoneFilterDefaults = {
    opportunityTypes: zone.opportunityTypes,
    serviceIds: zone.serviceIds,
    minPayCents: zone.minPayCents,
    minPayUnit: zone.minPayUnit,
    daysOfWeek: zone.daysOfWeek,
    timeStart: zone.timeStartLocal,
    timeEnd: zone.timeEndLocal,
    urgentOnly: zone.urgentOnly,
    exactOnly: zone.alertGrades.length === 1 && zone.alertGrades[0] === "exact",
    channelEmail: zone.channelEmail,
    channelSms: zone.channelSms,
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Edit watch zone</h1>
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <form action={updateZoneAction} className="mt-8 space-y-8">
        <input type="hidden" name="zoneId" value={zone.id} />
        <div className="oc-card space-y-6 p-6">
          <div className="max-w-sm">
            <label className="oc-label">Zone name</label>
            <input name="name" required minLength={2} defaultValue={zone.name} className="oc-input" />
          </div>
          <ZoneGeometryEditor cities={data.cities} defaults={metaToDefaults(zone.geometryMeta)} />
        </div>

        <div className="oc-card space-y-6 p-6">
          <ZoneFilterFields
            defaults={filterDefaults}
            myServices={data.myServices}
            smsAvailable={false}
          />
        </div>

        <button type="submit" className="oc-btn">
          Save changes
        </button>
      </form>
    </div>
  );
}
