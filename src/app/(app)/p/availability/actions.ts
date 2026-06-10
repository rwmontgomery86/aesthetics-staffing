"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { providerAvailability } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

const addSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    timeStart: z.string().regex(/^\d{2}:\d{2}$/),
    timeEnd: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .refine((value) => value.timeStart < value.timeEnd, {
    message: "End time must be after start time.",
  });

export async function addAvailabilityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = addSchema.safeParse({
    dayOfWeek: formData.get("dayOfWeek"),
    timeStart: formData.get("timeStart"),
    timeEnd: formData.get("timeEnd"),
  });
  if (!parsed.success) {
    redirect(
      "/p/availability?error=" +
        encodeURIComponent(parsed.error.issues[0].message ?? "Check the times and try again."),
    );
  }

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    await tx.insert(providerAvailability).values({
      providerProfileId: provider.id,
      dayOfWeek: parsed.data.dayOfWeek,
      timeStart: parsed.data.timeStart,
      timeEnd: parsed.data.timeEnd,
    });
  });
  redirect("/p/availability");
}

export async function removeAvailabilityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/p/availability");

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    await tx
      .delete(providerAvailability)
      .where(
        and(
          eq(providerAvailability.id, id.data),
          eq(providerAvailability.providerProfileId, provider.id),
        ),
      );
  });
  redirect("/p/availability");
}
