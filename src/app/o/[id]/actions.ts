"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import {
  applications,
  locations,
  opportunities,
  opportunityAlerts,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  profileAccessGrants,
  providerProfiles,
} from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { getOpportunityCredentialChips } from "@/lib/credentials/requirements";
import { ensureParticipant, getOrCreateThread } from "@/lib/messaging/threads";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";

function fail(backTo: string, message: string): never {
  const sep = backTo.includes("?") ? "&" : "?";
  redirect(`${backTo}${sep}error=${encodeURIComponent(message)}`);
}

const applySchema = z.object({
  opportunityId: z.string().uuid(),
  scope: z.enum(["series", "dates"]),
  occurrenceIds: z.array(z.string().uuid()).default([]),
  message: z.string().trim().max(2000, "Keep the message under 2,000 characters.").default(""),
});

/**
 * The apply flow (USER_FLOWS §7): one application row for the whole series,
 * or one row per chosen date. Credentials WARN, never block — the chips are
 * frozen onto the application so the business reviews exactly what the
 * provider saw. Applying auto-grants the org access to credentials +
 * portfolio (the profile_access_grants gate).
 */
export async function applyAction(formData: FormData) {
  const user = await getAuthUser();
  const oppIdRaw = String(formData.get("opportunityId") ?? "");
  const backTo = `/o/${oppIdRaw}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(backTo)}`);

  const parsed = applySchema.safeParse({
    opportunityId: oppIdRaw,
    scope: formData.get("scope") ?? "series",
    occurrenceIds: formData.getAll("occurrenceIds").map(String).filter(Boolean),
    message: String(formData.get("message") ?? ""),
  });
  if (!parsed.success) fail(backTo, parsed.error.issues[0].message);
  const data = parsed.data;

  const applicationIds = await dbAs(user, async (tx) => {
    const [provider] = await tx
      .select({ id: providerProfiles.id })
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, user.id));
    if (!provider) redirect(`/onboarding?next=${encodeURIComponent(backTo)}`);

    const [opp] = await tx
      .select({
        id: opportunities.id,
        organizationId: opportunities.organizationId,
        locationId: opportunities.locationId,
        status: opportunities.status,
        applicationDeadline: opportunities.applicationDeadline,
      })
      .from(opportunities)
      .where(eq(opportunities.id, data.opportunityId));
    if (!opp || opp.status !== "posted") {
      fail(backTo, "This opportunity is no longer accepting applications.");
    }
    if (opp.applicationDeadline && opp.applicationDeadline < new Date()) {
      fail(backTo, "The application deadline has passed.");
    }

    let occurrenceIds: (string | null)[] = [null];
    if (data.scope === "dates") {
      if (data.occurrenceIds.length === 0) fail(backTo, "Pick at least one date to apply for.");
      const valid = await tx
        .select({ id: opportunityOccurrences.id })
        .from(opportunityOccurrences)
        .where(
          and(
            inArray(opportunityOccurrences.id, data.occurrenceIds),
            eq(opportunityOccurrences.opportunityId, opp.id),
            eq(opportunityOccurrences.status, "open"),
            gt(opportunityOccurrences.startsAt, new Date()),
          ),
        );
      if (valid.length !== data.occurrenceIds.length) {
        fail(backTo, "Some of those dates are no longer open — refresh and pick again.");
      }
      occurrenceIds = valid.map((row) => row.id);
    }

    // Freeze the chips the provider is looking at right now.
    const [serviceRows, typeRows, [location]] = await Promise.all([
      tx
        .select({ serviceId: opportunityServices.serviceId })
        .from(opportunityServices)
        .where(eq(opportunityServices.opportunityId, opp.id)),
      tx
        .select({ providerTypeId: opportunityProviderTypes.providerTypeId })
        .from(opportunityProviderTypes)
        .where(eq(opportunityProviderTypes.opportunityId, opp.id)),
      tx
        .select({ state: locations.state })
        .from(locations)
        .where(eq(locations.id, opp.locationId)),
    ]);
    const chips = await getOpportunityCredentialChips(
      tx,
      provider.id,
      {
        serviceIds: serviceRows.map((row) => row.serviceId),
        providerTypeIds: typeRows.map((row) => row.providerTypeId),
      },
      location?.state ?? "GA",
    );

    // Arrived from a watch-zone alert? The ledger remembers.
    const [alert] = await tx
      .select({ watchZoneId: opportunityAlerts.watchZoneId })
      .from(opportunityAlerts)
      .where(
        and(
          eq(opportunityAlerts.opportunityId, opp.id),
          eq(opportunityAlerts.providerProfileId, provider.id),
        ),
      );

    const inserted = await tx
      .insert(applications)
      .values(
        occurrenceIds.map((occurrenceId) => ({
          opportunityId: opp.id,
          occurrenceId,
          providerProfileId: provider.id,
          scope: (occurrenceId == null ? "series" : "occurrence") as "series" | "occurrence",
          message: data.message || null,
          source: alert ? "watch_alert" : "search",
          watchZoneId: alert?.watchZoneId ?? null,
          credentialSnapshot: chips,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: applications.id });
    if (inserted.length === 0) {
      fail(backTo, "You've already applied to this opportunity — check My applications.");
    }

    // The single privacy gate: applying (re)grants this org access to your
    // credentials and portfolio. A previously revoked grant reopens here.
    await tx
      .insert(profileAccessGrants)
      .values({
        providerProfileId: provider.id,
        organizationId: opp.organizationId,
        grantedVia: "application",
        applicationId: inserted[0].id,
      })
      .onConflictDoUpdate({
        target: [profileAccessGrants.providerProfileId, profileAccessGrants.organizationId],
        set: { revokedAt: null, grantedVia: "application", applicationId: inserted[0].id },
      });

    // Applying opens the conversation (USER_FLOWS §7.4) — the business joins
    // lazily on first view, and the worker drops the "applied" milestone in.
    const thread = await getOrCreateThread(tx, {
      opportunityId: opp.id,
      organizationId: opp.organizationId,
      providerProfileId: provider.id,
      applicationId: inserted[0].id,
    });
    if (thread) await ensureParticipant(tx, thread.id, user.id);

    return inserted.map((row) => row.id);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "application_received", applicationIds }),
    "notify-application-received",
  );

  redirect(
    `${backTo}?notice=` +
      encodeURIComponent("Application sent — you'll hear back here and by email."),
  );
}
