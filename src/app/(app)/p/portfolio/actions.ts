"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { portfolioItems } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

export async function addPortfolioItemAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const path = String(formData.get("image") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  const serviceId = String(formData.get("serviceId") ?? "");
  const consent = formData.get("consent");

  if (!path) {
    redirect("/p/portfolio?error=" + encodeURIComponent("Upload an image first."));
  }
  if (consent !== "on") {
    redirect(
      "/p/portfolio?error=" +
        encodeURIComponent("The rights & consent attestation is required for portfolio images."),
    );
  }

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    await tx.insert(portfolioItems).values({
      providerProfileId: provider.id,
      storagePath: path,
      caption: caption || null,
      serviceId: z.string().uuid().safeParse(serviceId).success ? serviceId : null,
      consentAttestedAt: new Date(),
    });
  });
  redirect("/p/portfolio?notice=" + encodeURIComponent("Added to your portfolio."));
}

export async function removePortfolioItemAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/p/portfolio");

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    await tx
      .delete(portfolioItems)
      .where(and(eq(portfolioItems.id, id.data), eq(portfolioItems.providerProfileId, provider.id)));
  });
  redirect("/p/portfolio");
}
