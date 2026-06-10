"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

/**
 * Watch zones: all four kinds materialize to ONE geography column at save
 * time (radius → ST_Buffer, polygon → WKT ring, city/zip → reference
 * polygons), so the matching engine only ever sees `geom` + one GIST index.
 * geometry_meta keeps the source shape for UI re-render.
 */

const OPPORTUNITY_TYPES = [
  "one_time_shift",
  "recurring_shift",
  "part_time",
  "full_time",
  "contract",
  "popup_event",
  "evergreen",
] as const;

const baseSchema = z.object({
  name: z.string().trim().min(2, "Give this zone a name (e.g. 'Metro Atlanta').").max(60),
  kind: z.enum(["radius", "polygon", "city", "zip"]),
  minPay: z.coerce.number().min(0).max(100000).optional(),
  minPayUnit: z.enum(["hour", "day", "per_treatment", "commission_pct", "salary_year", "flat"]).default("hour"),
  timeStart: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")),
  timeEnd: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")),
});

const radiusSchema = z.object({
  centerLat: z.coerce.number().gte(-90).lte(90),
  centerLng: z.coerce.number().gte(-180).lte(180),
  radiusMeters: z.coerce.number().positive().max(200_000),
});

const pointSchema = z.object({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) });

function fail(returnTo: string, message: string): never {
  redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
}

/**
 * Postgres array literal as a single text param (cast at the call site).
 * Interpolating a JS array into drizzle's sql`` expands it per-element —
 * an EMPTY array expands to nothing and `()::enum[]` is a syntax error.
 * Values here are enum names / uuids / small ints — no quoting hazards.
 */
function pgArray(items: ReadonlyArray<string | number>): string {
  return `{${items.join(",")}}`;
}

interface Materialized {
  geomSql: ReturnType<typeof sql>;
  meta: Record<string, unknown>;
}

async function materialize(tx: Tx, kind: string, formData: FormData, returnTo: string): Promise<Materialized> {
  if (kind === "radius") {
    const parsed = radiusSchema.safeParse({
      centerLat: formData.get("centerLat"),
      centerLng: formData.get("centerLng"),
      radiusMeters: formData.get("radiusMeters"),
    });
    if (!parsed.success) fail(returnTo, "Tap the map to place your center point first.");
    const { centerLat, centerLng, radiusMeters } = parsed.data;
    return {
      geomSql: sql`st_buffer(st_setsrid(st_makepoint(${centerLng}, ${centerLat}), 4326)::geography, ${radiusMeters})`,
      meta: { kind: "radius", centerLat, centerLng, radiusMeters },
    };
  }

  if (kind === "polygon") {
    let points: unknown;
    try {
      points = JSON.parse(String(formData.get("points") ?? "[]"));
    } catch {
      fail(returnTo, "Draw your area on the map first.");
    }
    const parsed = z.array(pointSchema).min(3, "A drawn area needs at least 3 points.").max(200).safeParse(points);
    if (!parsed.success) fail(returnTo, "Draw at least 3 points on the map.");
    const ring = [...parsed.data, parsed.data[0]]; // close the ring
    const wkt = `POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;
    return {
      geomSql: sql`st_makevalid(st_setsrid(st_geomfromtext(${wkt}), 4326))::geography`,
      meta: { kind: "polygon", points: parsed.data },
    };
  }

  if (kind === "city") {
    const geoid = String(formData.get("cityGeoid") ?? "");
    if (!geoid) fail(returnTo, "Pick a city from the list.");
    const row = await tx.execute(sql`select geoid, name, state from geo_cities where geoid = ${geoid}`);
    const city = row.rows[0] as { geoid: string; name: string; state: string } | undefined;
    if (!city) fail(returnTo, "We don't have that city's boundary — try a radius zone instead.");
    return {
      geomSql: sql`(select geog from geo_cities where geoid = ${geoid})`,
      meta: { kind: "city", placeGeoid: city.geoid, name: city.name, state: city.state },
    };
  }

  // zip
  const zip = String(formData.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) fail(returnTo, "Enter a 5-digit ZIP code.");
  const row = await tx.execute(sql`select zip from geo_zips where zip = ${zip}`);
  if (!row.rows[0]) {
    fail(returnTo, "That ZIP isn't in our Georgia coverage — double-check it, or use a radius zone.");
  }
  return {
    geomSql: sql`(select geog from geo_zips where zip = ${zip})`,
    meta: { kind: "zip", zip },
  };
}

function parseShared(formData: FormData, returnTo: string) {
  const parsed = baseSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    minPay: formData.get("minPay") || undefined,
    minPayUnit: formData.get("minPayUnit") || "hour",
    timeStart: formData.get("timeStart") ?? "",
    timeEnd: formData.get("timeEnd") ?? "",
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0].message);

  const opportunityTypes = formData
    .getAll("opportunityType")
    .map(String)
    .filter((value): value is (typeof OPPORTUNITY_TYPES)[number] =>
      (OPPORTUNITY_TYPES as readonly string[]).includes(value),
    );
  const serviceIds = formData
    .getAll("serviceFilter")
    .map(String)
    .filter((value) => z.string().uuid().safeParse(value).success);
  const daysOfWeek = formData
    .getAll("day")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  return {
    ...parsed.data,
    // Empty selections mean "all" — stored as empty arrays.
    opportunityTypes: opportunityTypes.length === OPPORTUNITY_TYPES.length ? [] : opportunityTypes,
    serviceIds,
    daysOfWeek: daysOfWeek.length === 7 || daysOfWeek.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : daysOfWeek,
    urgentOnly: formData.get("urgentOnly") === "on",
    alertGrades: formData.get("exactOnly") === "on" ? ["exact"] : ["exact", "close"],
    channelInApp: true,
    channelEmail: formData.get("channelEmail") === "on",
    channelSms: formData.get("channelSms") === "on",
  };
}

export async function createZoneAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const returnTo = "/p/zones/new";
  const shared = parseShared(formData, returnTo);

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    const { geomSql, meta } = await materialize(tx, shared.kind, formData, returnTo);
    await tx.execute(sql`
      insert into watch_zones
        (provider_profile_id, name, kind, geom, geometry_meta,
         opportunity_types, service_ids, min_pay_cents, min_pay_unit,
         days_of_week, time_start_local, time_end_local,
         urgent_only, alert_grades, channel_in_app, channel_email, channel_sms)
      values
        (${provider.id}, ${shared.name}, ${shared.kind}, ${geomSql}, ${JSON.stringify(meta)}::jsonb,
         ${pgArray(shared.opportunityTypes)}::opportunity_type[], ${pgArray(shared.serviceIds)}::uuid[],
         ${shared.minPay != null ? Math.round(shared.minPay * 100) : null}, ${shared.minPayUnit},
         ${pgArray(shared.daysOfWeek)}::smallint[], ${shared.timeStart || null}, ${shared.timeEnd || null},
         ${shared.urgentOnly}, ${pgArray(shared.alertGrades)}::match_grade[],
         ${shared.channelInApp}, ${shared.channelEmail}, ${shared.channelSms})
    `);
  });

  redirect("/p/zones?notice=" + encodeURIComponent(`Watch zone "${shared.name}" is live.`));
}

export async function updateZoneAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const zoneId = z.string().uuid().safeParse(formData.get("zoneId"));
  if (!zoneId.success) redirect("/p/zones");
  const returnTo = `/p/zones/${zoneId.data}`;
  const shared = parseShared(formData, returnTo);

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    const { geomSql, meta } = await materialize(tx, shared.kind, formData, returnTo);
    // RLS restricts the update to the owner's rows; provider check is UX.
    await tx.execute(sql`
      update watch_zones set
        name = ${shared.name}, kind = ${shared.kind}, geom = ${geomSql},
        geometry_meta = ${JSON.stringify(meta)}::jsonb,
        opportunity_types = ${pgArray(shared.opportunityTypes)}::opportunity_type[],
        service_ids = ${pgArray(shared.serviceIds)}::uuid[],
        min_pay_cents = ${shared.minPay != null ? Math.round(shared.minPay * 100) : null},
        min_pay_unit = ${shared.minPayUnit},
        days_of_week = ${pgArray(shared.daysOfWeek)}::smallint[],
        time_start_local = ${shared.timeStart || null},
        time_end_local = ${shared.timeEnd || null},
        urgent_only = ${shared.urgentOnly},
        alert_grades = ${pgArray(shared.alertGrades)}::match_grade[],
        channel_email = ${shared.channelEmail},
        channel_sms = ${shared.channelSms}
      where id = ${zoneId.data} and provider_profile_id = ${provider.id}
    `);
  });

  redirect("/p/zones?notice=" + encodeURIComponent("Zone updated."));
}

export async function toggleZonePausedAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const zoneId = z.string().uuid().safeParse(formData.get("zoneId"));
  if (!zoneId.success) redirect("/p/zones");

  await dbAs(user, (tx) =>
    tx.execute(sql`update watch_zones set paused = not paused where id = ${zoneId.data}`),
  );
  redirect("/p/zones");
}

export async function deleteZoneAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const zoneId = z.string().uuid().safeParse(formData.get("zoneId"));
  if (!zoneId.success) redirect("/p/zones");

  await dbAs(user, (tx) => tx.execute(sql`delete from watch_zones where id = ${zoneId.data}`));
  redirect("/p/zones");
}
