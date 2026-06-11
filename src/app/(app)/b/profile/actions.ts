"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { organizations } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import { ORG_KIND_VALUES, type OrgKind } from "@/lib/org-kinds";

const schema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2, "Please enter your business name."),
  kind: z.string().refine((v): v is OrgKind => (ORG_KIND_VALUES as string[]).includes(v), {
    message: "Pick a business type from the list.",
  }),
  description: z.string().trim().max(2000).default(""),
  website: z.string().trim().url("Website should be a full URL (https://…).").or(z.literal("")),
  phone: z.string().trim().max(30).default(""),
  softwareEmrPos: z.string().trim().max(120).default(""),
});

export async function updateOrganizationAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
    kind: formData.get("kind"),
    description: formData.get("description"),
    website: formData.get("website"),
    phone: formData.get("phone"),
    softwareEmrPos: formData.get("softwareEmrPos"),
  });
  if (!parsed.success) {
    redirect(`/b/profile?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }
  const data = parsed.data;
  const logoPath = String(formData.get("logo") ?? "");

  await requireOrgRole(data.organizationId, "admin");

  await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .update(organizations)
      .set({
        name: data.name,
        kind: data.kind,
        description: data.description || null,
        website: data.website || null,
        phone: data.phone || null,
        softwareEmrPos: data.softwareEmrPos || null,
        ...(logoPath ? { logoPath } : {}),
      })
      .where(eq(organizations.id, data.organizationId)),
  );

  redirect("/b/profile?notice=" + encodeURIComponent("Business profile saved."));
}
