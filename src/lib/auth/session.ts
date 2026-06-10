import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getSupabaseServer } from "@/lib/supabase/server";
import { dbAs } from "@/db/client";
import { organizationMembers, organizations, profiles, providerProfiles } from "@/db/schema";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface OrgContext {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "poster";
}

/** The "hats" a user can wear — any combination may be true. */
export interface UserContexts {
  user: AuthUser;
  fullName: string;
  isAdmin: boolean;
  provider: { id: string; displayName: string } | null;
  orgs: OrgContext[];
}

/** Who is signed in, per Supabase Auth (null if nobody). Cached per request. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
});

/** Everything the shell needs to render hats + switcher. Cached per request. */
export const getUserContexts = cache(async (): Promise<UserContexts | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  return dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
    const [provider] = await tx
      .select({ id: providerProfiles.id, displayName: providerProfiles.displayName })
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, user.id));
    const orgs = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, user.id));

    return {
      user,
      fullName: profile?.fullName ?? "",
      isAdmin: profile?.isPlatformAdmin ?? false,
      provider: provider ?? null,
      orgs,
    };
  });
});
