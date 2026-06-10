"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { providerProfiles } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

const PAY_UNITS = ["hour", "day", "per_treatment", "commission_pct", "salary_year", "flat"] as const;

const schema = z.object({
  payMin: z.coerce.number().min(0).max(100000).optional(),
  payMinUnit: z.enum(PAY_UNITS).default("hour"),
  structures: z.array(z.enum(PAY_UNITS)).default([]),
  urgentAvailable: z.literal("on").optional(),
  availableNow: z.enum(["", "today", "this_week"]).default(""),
});

export async function updatePayAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse({
    payMin: formData.get("payMin") || undefined,
    payMinUnit: formData.get("payMinUnit"),
    structures: formData.getAll("structure"),
    urgentAvailable: formData.get("urgentAvailable") ?? undefined,
    availableNow: formData.get("availableNow") ?? "",
  });
  if (!parsed.success) {
    redirect("/p/pay?error=" + encodeURIComponent("Check the pay values and try again."));
  }
  const data = parsed.data;

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    await tx
      .update(providerProfiles)
      .set({
        payMinCents: data.payMin != null ? Math.round(data.payMin * 100) : null,
        payMinUnit: data.payMin != null ? data.payMinUnit : null,
        payStructuresAccepted: data.structures,
        urgentAvailable: data.urgentAvailable === "on",
        availableNowStatus: data.availableNow || null,
        availableNowSetAt: data.availableNow ? new Date() : null,
      })
      .where(eq(providerProfiles.id, provider.id));
  });

  redirect("/p/pay?notice=" + encodeURIComponent("Pay preferences saved."));
}
