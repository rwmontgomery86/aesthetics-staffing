import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
// @ts-expect-error shapefile ships no types
import * as shapefile from "shapefile";
import pg from "pg";

/**
 * Loads Georgia boundary reference data into geo_zips / geo_cities from the
 * US Census cartographic boundary files (public domain, 1:500k generalized):
 *
 *   - ZCTAs:  cb_2020_us_zcta520_500k  (national file; filtered to GA prefixes)
 *   - Places: cb_2023_13_place_500k    (GA = state FIPS 13)
 *
 * Known approximation (accepted, documented in MATCHING_LOGIC.md): ZCTAs ≠
 * USPS ZIP routes, and the national ZCTA file has no state attribute, so GA
 * membership is by ZIP prefix (30xxx, 31xxx, 398xx-399xx).
 *
 * Idempotent: upserts by primary key. Re-run any time; geometry_meta on watch
 * zones keeps source refs so zones can be re-materialized after a data update.
 *
 * Usage: npm run geo:load            (downloads ~70 MB once into .geo-cache/)
 */

const CACHE_DIR = ".geo-cache";
const ZCTA_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip";
const PLACE_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_13_place_500k.zip";

const GA_ZIP_PREFIXES = /^(30\d{3}|31\d{3}|39[89]\d{2})$/;

async function download(url: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, path.basename(url));
  if (existsSync(file)) {
    console.log(`  cached: ${file}`);
    return file;
  }
  console.log(`  downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function extract(zipFile: string): { shp: Buffer; dbf: Buffer } {
  const zip = new AdmZip(zipFile);
  const entries = zip.getEntries();
  const shp = entries.find((e) => e.entryName.endsWith(".shp"));
  const dbf = entries.find((e) => e.entryName.endsWith(".dbf"));
  if (!shp || !dbf) throw new Error(`zip missing .shp/.dbf: ${zipFile}`);
  return { shp: shp.getData(), dbf: dbf.getData() };
}

type Feature = { properties: Record<string, unknown>; geometry: unknown };

async function* features(zipFile: string): AsyncGenerator<Feature> {
  const { shp, dbf } = extract(zipFile);
  const source = await shapefile.open(shp, dbf);
  for (;;) {
    const result = await source.read();
    if (result.done) return;
    yield result.value as Feature;
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
  await client.connect();

  console.log("→ Georgia places (geo_cities)");
  const placeZip = await download(PLACE_URL);
  let cities = 0;
  for await (const f of features(placeZip)) {
    const geoid = String(f.properties.GEOID ?? "");
    const name = String(f.properties.NAME ?? "");
    if (!geoid || !name) continue;
    await client.query(
      `insert into geo_cities (geoid, name, state, geog)
       values ($1, $2, 'GA', st_multi(st_makevalid(st_geomfromgeojson($3)))::geography)
       on conflict (geoid) do update set name = excluded.name, geog = excluded.geog`,
      [geoid, name, JSON.stringify(f.geometry)],
    );
    cities++;
  }
  console.log(`  ✓ ${cities} GA places`);

  console.log("→ Georgia ZCTAs (geo_zips) — filtering national file");
  const zctaZip = await download(ZCTA_URL);
  let zips = 0;
  for await (const f of features(zctaZip)) {
    const zip5 = String(f.properties.ZCTA5CE20 ?? f.properties.GEOID20 ?? "");
    if (!GA_ZIP_PREFIXES.test(zip5)) continue;
    await client.query(
      `insert into geo_zips (zip, state, geog)
       values ($1, 'GA', st_multi(st_makevalid(st_geomfromgeojson($2)))::geography)
       on conflict (zip) do update set geog = excluded.geog`,
      [zip5, JSON.stringify(f.geometry)],
    );
    zips++;
  }
  console.log(`  ✓ ${zips} GA ZCTAs`);

  await client.end();
  console.log("✓ geo load complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
