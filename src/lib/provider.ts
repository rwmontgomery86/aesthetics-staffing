import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { dbAs, type Tx } from "@/db/client";
import { providerProfiles } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";

/** Full provider row for the signed-in user (RLS-enforced), or redirect. */
export async function requireProviderRow() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const provider = await dbAs(user, async (tx) => {
    const [row] = await tx
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, user.id));
    return row ?? null;
  });
  if (!provider) redirect("/onboarding");
  return { user, provider };
}

/** Same, but inside an existing dbAs transaction (for server actions). */
export async function providerInTx(tx: Tx, userId: string) {
  const [row] = await tx
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, userId));
  if (!row) throw new Error("provider profile missing");
  return row;
}
