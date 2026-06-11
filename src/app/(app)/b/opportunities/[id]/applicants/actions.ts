"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import { applications, opportunities } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";
import { assertApplicationTransition, type ApplicationStatus } from "@/lib/state/application";

/**
 * Selection actions operate on a provider's whole candidacy for the post —
 * every active application row they have on it (one series row, or one row
 * per chosen date) moves together.
 */

const actionSchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  providerProfileId: z.string().uuid(),
});

function fail(backTo: string, message: string): never {
  redirect(`${backTo}?error=${encodeURIComponent(message)}`);
}

async function loadCandidacy(
  tx: Tx,
  organizationId: string,
  opportunityId: string,
  providerProfileId: string,
  statuses: ApplicationStatus[],
) {
  const [opp] = await tx
    .select({ id: opportunities.id, status: opportunities.status })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
  if (!opp) redirect("/b/opportunities");
  const rows = await tx
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.opportunityId, opportunityId),
        eq(applications.providerProfileId, providerProfileId),
        inArray(applications.status, statuses),
      ),
    );
  return { opp, rows };
}

async function parseAndGuard(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = actionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    opportunityId: formData.get("opportunityId"),
    providerProfileId: formData.get("providerProfileId"),
  });
  if (!parsed.success) redirect("/b/opportunities");
  await requireOrgRole(parsed.data.organizationId, "poster");
  return { user, ...parsed.data };
}

export async function shortlistApplicantAction(formData: FormData) {
  const { user, organizationId, opportunityId, providerProfileId } = await parseAndGuard(formData);
  const backTo = `/b/opportunities/${opportunityId}/applicants`;

  await dbAs(user, async (tx) => {
    const { rows } = await loadCandidacy(tx, organizationId, opportunityId, providerProfileId, [
      "submitted",
      "viewed",
    ]);
    if (rows.length === 0) fail(backTo, "That application isn't open for shortlisting anymore.");
    for (const row of rows) assertApplicationTransition(row.status, "shortlisted");
    await tx
      .update(applications)
      .set({ status: "shortlisted", statusChangedAt: new Date() })
      .where(inArray(applications.id, rows.map((row) => row.id)));
  });
  redirect(`${backTo}?notice=` + encodeURIComponent("Shortlisted."));
}

/**
 * The business's half of the dual confirmation: making the offer IS its
 * terms click-through — the offered rows' status_changed_at becomes the
 * business confirmation timestamp frozen onto the booking when the provider
 * accepts (USER_FLOWS §9).
 */
export async function offerApplicantAction(formData: FormData) {
  const { user, organizationId, opportunityId, providerProfileId } = await parseAndGuard(formData);
  const backTo = `/b/opportunities/${opportunityId}/applicants`;
  if (formData.get("termsAccepted") !== "on") {
    fail(backTo, "Accept the booking terms to send the offer.");
  }

  const ids = await dbAs(user, async (tx) => {
    const { opp, rows } = await loadCandidacy(tx, organizationId, opportunityId, providerProfileId, [
      "submitted",
      "viewed",
      "shortlisted",
    ]);
    if (opp.status !== "posted") {
      fail(backTo, `Offers can only go out on posted opportunities (this one is ${opp.status}).`);
    }
    if (rows.length === 0) fail(backTo, "No active application from that provider.");
    for (const row of rows) assertApplicationTransition(row.status, "offered");
    await tx
      .update(applications)
      .set({ status: "offered", statusChangedAt: new Date() })
      .where(inArray(applications.id, rows.map((row) => row.id)));
    return rows.map((row) => row.id);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "application_offered", applicationIds: ids }),
    "notify-application-offered",
  );
  redirect(
    `${backTo}?notice=` +
      encodeURIComponent("Offer sent — the booking locks in when the provider confirms."),
  );
}

export async function declineApplicantAction(formData: FormData) {
  const { user, organizationId, opportunityId, providerProfileId } = await parseAndGuard(formData);
  const backTo = `/b/opportunities/${opportunityId}/applicants`;

  const ids = await dbAs(user, async (tx) => {
    const { rows } = await loadCandidacy(tx, organizationId, opportunityId, providerProfileId, [
      "submitted",
      "viewed",
      "shortlisted",
      "offered",
    ]);
    if (rows.length === 0) fail(backTo, "That application is already closed.");
    for (const row of rows) assertApplicationTransition(row.status, "declined");
    await tx
      .update(applications)
      .set({ status: "declined", statusChangedAt: new Date() })
      .where(inArray(applications.id, rows.map((row) => row.id)));
    return rows.map((row) => row.id);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "application_declined", applicationIds: ids, by: "business" }),
    "notify-application-declined",
  );
  redirect(`${backTo}?notice=` + encodeURIComponent("Application declined."));
}
