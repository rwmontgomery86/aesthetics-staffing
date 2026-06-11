"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import { locations } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import { geocoder, timezoneForState, withinGaBounds } from "@/lib/geocode";

const schema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2, "Give this location a name (e.g. Buckhead studio)."),
  addressLine1: z.string().trim().min(3, "Please enter the street address."),
  addressLine2: z.string().trim().max(120).default(""),
  city: z.string().trim().min(2, "Please enter the city."),
  state: z.literal("GA", { message: "The launch area is Georgia — locations must be in GA." }),
  zip: z.string().trim().regex(/^\d{5}$/, "ZIP code should be 5 digits."),
  phone: z.string().trim().max(30).default(""),
  parkingNotes: z.string().trim().max(1000).default(""),
  dressCode: z.string().trim().max(1000).default(""),
  supervisionContext: z.string().trim().max(2000).default(""),
  equipment: z.string().trim().max(2000).default(""),
  productsBrands: z.string().trim().max(2000).default(""),
  active: z.literal("on").optional(),
});

type LocationForm = z.infer<typeof schema>;

const BAD_ADDRESS =
  "We couldn't place that address on the map — double-check the street address and ZIP (Georgia only for now).";

function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseForm(formData: FormData, backTo: string): LocationForm {
  const parsed = schema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    zip: formData.get("zip"),
    phone: formData.get("phone"),
    parkingNotes: formData.get("parkingNotes"),
    dressCode: formData.get("dressCode"),
    supervisionContext: formData.get("supervisionContext"),
    equipment: formData.get("equipment"),
    productsBrands: formData.get("productsBrands"),
    active: formData.get("active") ?? undefined,
  });
  if (!parsed.success) {
    redirect(`${backTo}?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }
  return parsed.data;
}

/**
 * Street-level geocode, done BEFORE the transaction opens — the pool is small
 * and Nominatim is rate-limited, so the network wait must not hold a
 * connection. A hit outside Georgia means the geocoder matched the wrong
 * place; treat it as a miss.
 */
async function geocodeAddress(data: LocationForm): Promise<{ lat: number; lng: number } | null> {
  const hit = await geocoder.geocode({
    addressLine: [data.addressLine1, data.addressLine2].filter(Boolean).join(" "),
    city: data.city,
    state: data.state,
    zip: data.zip,
  });
  return hit && withinGaBounds(hit.lat, hit.lng) ? hit : null;
}

/** Fallback pin: the ZIP's boundary centroid (same approach as provider home). */
async function zipCentroid(tx: Tx, zip: string): Promise<{ lat: number; lng: number } | null> {
  const centroid = await tx.execute(sql`
    select st_y(st_centroid(geog::geometry)) as lat,
           st_x(st_centroid(geog::geometry)) as lng
    from geo_zips where zip = ${zip} and state = 'GA'
  `);
  return (centroid.rows[0] as { lat: number; lng: number } | undefined) ?? null;
}

function locationValues(data: LocationForm) {
  return {
    name: data.name,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2 || null,
    city: data.city,
    state: data.state,
    zip: data.zip,
    timezone: timezoneForState(data.state),
    phone: data.phone || null,
    parkingNotes: data.parkingNotes || null,
    dressCode: data.dressCode || null,
    supervisionContext: data.supervisionContext || null,
    equipment: parseList(data.equipment),
    productsBrands: parseList(data.productsBrands),
  };
}

async function setGeog(tx: Tx, locationId: string, point: { lat: number; lng: number }) {
  await tx.execute(sql`
    update locations
    set geog = st_setsrid(st_makepoint(${point.lng}, ${point.lat}), 4326)::geography
    where id = ${locationId}
  `);
}

export async function createLocationAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const backTo = "/b/locations/new";
  const data = parseForm(formData, backTo);
  await requireOrgRole(data.organizationId, "admin");

  const geocoded = await geocodeAddress(data);

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const point = geocoded ?? (await zipCentroid(tx, data.zip));
    if (!point) redirect(`${backTo}?error=${encodeURIComponent(BAD_ADDRESS)}`);

    const [row] = await tx
      .insert(locations)
      .values({ organizationId: data.organizationId, ...locationValues(data) })
      .returning({ id: locations.id });
    await setGeog(tx, row.id, point);
  });

  redirect("/b/locations?notice=" + encodeURIComponent("Location saved."));
}

export async function updateLocationAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) redirect("/b/locations");
  const backTo = `/b/locations/${locationId}`;
  const data = parseForm(formData, backTo);
  await requireOrgRole(data.organizationId, "admin");

  const geocoded = await geocodeAddress(data);

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const point = geocoded ?? (await zipCentroid(tx, data.zip));
    if (!point) redirect(`${backTo}?error=${encodeURIComponent(BAD_ADDRESS)}`);

    // organizationId in the WHERE keeps a forged form from moving another
    // org's location (RLS would block the write anyway — belt and suspenders).
    const updated = await tx
      .update(locations)
      .set({ ...locationValues(data), active: data.active === "on" })
      .where(and(eq(locations.id, locationId), eq(locations.organizationId, data.organizationId)))
      .returning({ id: locations.id });
    if (updated.length === 0) redirect("/b/locations");

    await setGeog(tx, locationId, point);
  });

  redirect("/b/locations?notice=" + encodeURIComponent("Location saved."));
}
