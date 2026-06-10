import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { watchZones } from "@/db/schema";
import { requireProviderRow } from "@/lib/provider";
import { deleteZoneAction, toggleZonePausedAction } from "./actions";

export const metadata = { title: "Watch zones" };

function describeGeometry(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const data = meta as Record<string, unknown>;
  switch (data.kind) {
    case "radius":
      return `${Math.round(Number(data.radiusMeters ?? 0) / 1609.34)} mi radius`;
    case "polygon":
      return `Drawn area · ${(data.points as unknown[] | undefined)?.length ?? 0} points`;
    case "city":
      return `City boundary · ${String(data.name ?? "")}`;
    case "zip":
      return `ZIP ${String(data.zip ?? "")}`;
    default:
      return "";
  }
}

export default async function ZonesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ notice }, { user, provider }] = await Promise.all([searchParams, requireProviderRow()]);
  const zones = await dbAs(user, (tx) =>
    tx.select().from(watchZones).where(eq(watchZones.providerProfileId, provider.id)).orderBy(asc(watchZones.createdAt)),
  );

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Watch zones</h1>
          <p className="mt-2 text-ink-soft">
            Where you want opportunity alerts. No zones, no alerts — most providers start with one
            radius around home.
          </p>
        </div>
        <Link href="/p/zones/new" className="oc-btn">
          + New zone
        </Link>
      </div>

      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <div className="mt-8 space-y-4">
        {zones.length === 0 ? (
          <div className="oc-card p-8 text-center">
            <p className="font-medium">No watch zones yet</p>
            <p className="mt-1 text-sm text-ink-soft">
              Create your first zone to start getting matched the moment opportunities post.
            </p>
            <Link href="/p/zones/new" className="oc-btn mt-4">
              Create a watch zone
            </Link>
          </div>
        ) : (
          zones.map((zone) => (
            <div key={zone.id} className={`oc-card p-5 ${zone.paused ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    {zone.name}
                    {zone.paused ? (
                      <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium">
                        Paused
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {describeGeometry(zone.geometryMeta)}
                    {zone.minPayCents != null
                      ? ` · $${(zone.minPayCents / 100).toFixed(0)}+/${zone.minPayUnit === "hour" ? "hr" : zone.minPayUnit}`
                      : ""}
                    {zone.alertGrades.length === 1 ? " · exact only" : ""}
                    {zone.urgentOnly ? " · urgent only" : ""}
                    {` · ${[zone.channelInApp && "in-app", zone.channelEmail && "email", zone.channelSms && "SMS"].filter(Boolean).join(", ")}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Link href={`/p/zones/${zone.id}`} className="oc-btn-ghost">
                    Edit
                  </Link>
                  <form action={toggleZonePausedAction}>
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <button type="submit" className="oc-btn-ghost">
                      {zone.paused ? "Resume" : "Pause"}
                    </button>
                  </form>
                  <form action={deleteZoneAction}>
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <button type="submit" className="oc-btn-ghost text-danger">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
