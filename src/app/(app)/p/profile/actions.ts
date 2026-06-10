"use server";

import { redirect } from "next/navigation";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { providerProfiles } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

const schema = z.object({
  displayName: z.string().trim().min(2, "Please enter the name businesses should see."),
  bio: z.string().trim().max(2000).default(""),
  homeCity: z.string().trim().max(80).default(""),
  homeZip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "ZIP code should be 5 digits.")
    .or(z.literal("")),
  travelRadiusMi: z.coerce.number().int().min(1).max(300).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  instagram: z.string().trim().max(80).default(""),
  hiddenFromSearch: z.literal("on").optional(),
});

export async function updateProfileAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    bio: formData.get("bio"),
    homeCity: formData.get("homeCity"),
    homeZip: formData.get("homeZip"),
    travelRadiusMi: formData.get("travelRadiusMi") || undefined,
    yearsExperience: formData.get("yearsExperience") || undefined,
    instagram: formData.get("instagram"),
    hiddenFromSearch: formData.get("hiddenFromSearch") ?? undefined,
  });
  if (!parsed.success) {
    redirect(`/p/profile?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }
  const data = parsed.data;
  const headshotPath = String(formData.get("headshot") ?? "");

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);

    // GA-only launch: home point comes from the ZIP's boundary centroid —
    // no external geocoder needed.
    let homeState: string | null = provider.homeState;
    if (data.homeZip) {
      const centroid = await tx.execute(sql`
        select state,
               st_y(st_centroid(geog::geometry)) as lat,
               st_x(st_centroid(geog::geometry)) as lng
        from geo_zips where zip = ${data.homeZip}
      `);
      const row = centroid.rows[0] as { state: string; lat: number; lng: number } | undefined;
      if (!row) {
        redirect(
          `/p/profile?error=${encodeURIComponent(
            "We don't recognize that ZIP — the launch area is Georgia. Double-check the code.",
          )}`,
        );
      }
      homeState = row.state;
      await tx.execute(sql`
        update provider_profiles
        set home_location = st_setsrid(st_makepoint(${row.lng}, ${row.lat}), 4326)::geography
        where id = ${provider.id}
      `);
    }

    await tx
      .update(providerProfiles)
      .set({
        displayName: data.displayName,
        bio: data.bio || null,
        homeCity: data.homeCity || null,
        homeState: homeState as never,
        homeZip: data.homeZip || null,
        travelRadiusM: data.travelRadiusMi ? Math.round(data.travelRadiusMi * 1609.34) : null,
        yearsExperience: data.yearsExperience ?? null,
        socialHandles: data.instagram ? { instagram: data.instagram } : {},
        hiddenFromSearch: data.hiddenFromSearch === "on",
        ...(headshotPath ? { headshotPath } : {}),
      })
      .where(eq(providerProfiles.id, provider.id));
  });

  redirect("/p/profile?notice=" + encodeURIComponent("Profile saved."));
}
