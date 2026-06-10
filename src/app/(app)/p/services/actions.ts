"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { providerProfileTypes, providerServices } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

const uuids = z.array(z.string().uuid());

export async function updateServicesAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const typeIds = uuids.safeParse(formData.getAll("ptype"));
  const serviceIds = uuids.safeParse(formData.getAll("service"));
  if (!typeIds.success || !serviceIds.success) {
    redirect("/p/services?error=" + encodeURIComponent("Something went wrong — try again."));
  }
  if (typeIds.data.length === 0) {
    redirect("/p/services?error=" + encodeURIComponent("Pick at least one provider category."));
  }

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);

    // Replace-set semantics, scoped to own rows (RLS enforces ownership too).
    await tx.delete(providerProfileTypes).where(eq(providerProfileTypes.providerProfileId, provider.id));
    await tx.insert(providerProfileTypes).values(
      typeIds.data.map((providerTypeId, index) => ({
        providerProfileId: provider.id,
        providerTypeId,
        isPrimary: index === 0,
      })),
    );

    const existing = await tx
      .select({ serviceId: providerServices.serviceId })
      .from(providerServices)
      .where(eq(providerServices.providerProfileId, provider.id));
    const keep = new Set(serviceIds.data);
    const toRemove = existing.map((row) => row.serviceId).filter((id) => !keep.has(id));
    const have = new Set(existing.map((row) => row.serviceId));
    const toAdd = serviceIds.data.filter((id) => !have.has(id));

    if (toRemove.length > 0) {
      await tx
        .delete(providerServices)
        .where(
          and(
            eq(providerServices.providerProfileId, provider.id),
            inArray(providerServices.serviceId, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(providerServices)
        .values(toAdd.map((serviceId) => ({ providerProfileId: provider.id, serviceId })));
    }
  });

  redirect("/p/services?notice=" + encodeURIComponent("Services saved."));
}
