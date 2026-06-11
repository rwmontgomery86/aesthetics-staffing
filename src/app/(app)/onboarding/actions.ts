"use server";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { writeActiveContextCookie } from "@/lib/auth/context";
import { dbAs } from "@/db/client";
import { organizationMembers, organizations, providerProfiles } from "@/db/schema";
import { ORG_KIND_VALUES } from "@/lib/org-kinds";
import { makeSlug } from "@/lib/slug";

function fail(message: string): never {
  redirect(`/onboarding?error=${encodeURIComponent(message)}`);
}

/** Minimal "provider hat" — the full onboarding wizard is Phase 3. */
export async function createProviderAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName.length < 2) fail("Please enter the name providers should see.");

  try {
    await dbAs(user, (tx) =>
      tx.insert(providerProfiles).values({
        userId: user.id,
        slug: makeSlug(displayName),
        displayName,
        homeState: "GA",
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("duplicate key")) fail("You already have a provider profile.");
    throw err;
  }

  await writeActiveContextCookie({ kind: "provider" });
  redirect("/p");
}

/** Creates the org + owner membership; the /b checklist drives the rest. */
export async function createOrganizationAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) fail("Please enter your business name.");
  const rawKind = String(formData.get("kind") ?? "other");
  const kind = (ORG_KIND_VALUES as string[]).includes(rawKind) ? rawKind : "other";

  const orgId = await dbAs(user, async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name, slug: makeSlug(name), kind, createdByUserId: user.id })
      .returning({ id: organizations.id });
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: "owner",
      acceptedAt: new Date(),
    });
    return org.id;
  });

  await writeActiveContextCookie({ kind: "org", orgId });
  redirect("/b");
}
