import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { locations } from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import { roleAtLeast } from "@/lib/auth/guards";

export const metadata = { title: "Locations" };

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg(),
  ]);
  const canManage = roleAtLeast(org.role, "admin");

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, (tx) =>
    tx
      .select({
        id: locations.id,
        name: locations.name,
        addressLine1: locations.addressLine1,
        addressLine2: locations.addressLine2,
        city: locations.city,
        state: locations.state,
        zip: locations.zip,
        active: locations.active,
        hasPin: sql<boolean>`${locations.geog} is not null`,
      })
      .from(locations)
      .where(eq(locations.organizationId, org.id))
      .orderBy(asc(locations.createdAt)),
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Locations</h1>
          <p className="mt-2 text-ink-soft">
            Each location gets a map pin — opportunities you post are matched from here.
          </p>
        </div>
        {canManage ? (
          <Link href="/b/locations/new" className="oc-btn shrink-0">
            Add location
          </Link>
        ) : null}
      </div>

      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <div className="mt-8 space-y-3">
        {rows.length === 0 ? (
          <div className="oc-card p-6 text-center">
            <p className="font-medium">No locations yet</p>
            <p className="mt-1 text-sm text-ink-soft">
              {canManage
                ? "Add your first location — you'll need one before posting opportunities."
                : "An owner or admin needs to add the first location."}
            </p>
          </div>
        ) : (
          rows.map((loc) => (
            <Link
              key={loc.id}
              href={canManage ? `/b/locations/${loc.id}` : "/b/locations"}
              className={`oc-card flex items-center justify-between gap-4 p-4 ${
                canManage ? "transition-colors hover:border-lilac-soft" : "cursor-default"
              }`}
            >
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {loc.name}
                  {!loc.active ? (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink-soft">
                      inactive
                    </span>
                  ) : null}
                </span>
                <span className="block text-sm text-ink-soft">
                  {loc.addressLine1}
                  {loc.addressLine2 ? `, ${loc.addressLine2}` : ""} · {loc.city}, {loc.state}{" "}
                  {loc.zip}
                </span>
              </span>
              <span className="shrink-0 text-sm text-ink-soft">
                {loc.hasPin ? "📍 pinned" : "no pin"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
