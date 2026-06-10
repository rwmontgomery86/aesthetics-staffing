import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import { createProvider } from "./helpers/fixtures";

/**
 * Zone materialization: every kind (radius/polygon/city/zip) must produce a
 * valid geography in the single `geom` column, through the RLS-enforced path
 * (owner insert policy). Mirrors the SQL in src/app/(app)/p/zones/actions.ts.
 * Requires GA geo data loaded (npm run geo:load) for city/zip kinds.
 */

const MIDTOWN = { lat: 33.7838, lng: -84.3853 };

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await endRlsPool();
  await servicePool.end();
});

async function intersectsMidtown(zoneId: string): Promise<boolean> {
  const result = await serviceDb.execute(sql`
    select st_intersects(
      geom,
      st_setsrid(st_makepoint(${MIDTOWN.lng}, ${MIDTOWN.lat}), 4326)::geography
    ) as hit
    from watch_zones where id = ${zoneId}
  `);
  return Boolean((result.rows[0] as { hit: boolean }).hit);
}

describe("watch-zone materialization (all four kinds → one geom column)", () => {
  it("radius: buffered center contains a point inside the radius", async () => {
    const { user, profile } = await createProvider("rlstest-zone-radius");
    const inserted = await dbAs(user.id, (tx) =>
      tx.execute(sql`
        insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
        values (${profile.id}, 'R', 'radius',
          st_buffer(st_setsrid(st_makepoint(${MIDTOWN.lng}, ${MIDTOWN.lat}), 4326)::geography, 10000),
          ${JSON.stringify({ kind: "radius", centerLat: MIDTOWN.lat, centerLng: MIDTOWN.lng, radiusMeters: 10000 })}::jsonb)
        returning id
      `),
    );
    const zoneId = (inserted.rows[0] as { id: string }).id;
    expect(await intersectsMidtown(zoneId)).toBe(true);
  });

  it("polygon: closed WKT ring is valid and contains an interior point", async () => {
    const { user, profile } = await createProvider("rlstest-zone-poly");
    const ring = [
      { lat: 33.7, lng: -84.5 },
      { lat: 33.9, lng: -84.5 },
      { lat: 33.9, lng: -84.3 },
      { lat: 33.7, lng: -84.3 },
      { lat: 33.7, lng: -84.5 },
    ];
    const wkt = `POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;
    const inserted = await dbAs(user.id, (tx) =>
      tx.execute(sql`
        insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
        values (${profile.id}, 'P', 'polygon',
          st_makevalid(st_setsrid(st_geomfromtext(${wkt}), 4326))::geography,
          ${JSON.stringify({ kind: "polygon", points: ring.slice(0, 4) })}::jsonb)
        returning id, st_isvalid(geom::geometry) as valid
      `),
    );
    const row = inserted.rows[0] as { id: string; valid: boolean };
    expect(row.valid).toBe(true);
    expect(await intersectsMidtown(row.id)).toBe(true);
  });

  it("city: Atlanta's reference polygon materializes and contains Midtown", async () => {
    const atlanta = await serviceDb.execute(
      sql`select geoid from geo_cities where name = 'Atlanta' and state = 'GA'`,
    );
    if (!atlanta.rows.length) return; // geo data not loaded in this environment
    const geoid = (atlanta.rows[0] as { geoid: string }).geoid;

    const { user, profile } = await createProvider("rlstest-zone-city");
    const inserted = await dbAs(user.id, (tx) =>
      tx.execute(sql`
        insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
        values (${profile.id}, 'C', 'city',
          (select geog from geo_cities where geoid = ${geoid}),
          ${JSON.stringify({ kind: "city", placeGeoid: geoid, name: "Atlanta", state: "GA" })}::jsonb)
        returning id
      `),
    );
    expect(await intersectsMidtown((inserted.rows[0] as { id: string }).id)).toBe(true);
  });

  it("zip: ZCTA 30309 materializes and contains Midtown; bogus ZIP has no boundary", async () => {
    const zcta = await serviceDb.execute(sql`select zip from geo_zips where zip = '30309'`);
    if (!zcta.rows.length) return; // geo data not loaded in this environment

    const { user, profile } = await createProvider("rlstest-zone-zip");
    const inserted = await dbAs(user.id, (tx) =>
      tx.execute(sql`
        insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
        values (${profile.id}, 'Z', 'zip',
          (select geog from geo_zips where zip = '30309'),
          ${JSON.stringify({ kind: "zip", zip: "30309" })}::jsonb)
        returning id
      `),
    );
    expect(await intersectsMidtown((inserted.rows[0] as { id: string }).id)).toBe(true);

    const missing = await serviceDb.execute(sql`select zip from geo_zips where zip = '99999'`);
    expect(missing.rows).toHaveLength(0);
  });
});
