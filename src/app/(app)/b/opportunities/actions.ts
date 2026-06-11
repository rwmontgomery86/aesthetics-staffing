"use server";

import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import {
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  serviceCategories,
  services,
} from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import { enqueueFanoutPosted, enqueueFanoutUpdated, tryEnqueue } from "@/lib/queue";
import { opportunityTypeMeta } from "@/lib/opportunity-types";
import {
  MATERIALIZE_WEEKS,
  buildWeeklyRRule,
  durationMinutes,
  expandWeekly,
  localOccurrence,
} from "@/lib/recurrence";
import {
  assertOccurrenceTransition,
  assertOpportunityTransition,
  type OpportunityStatus,
} from "@/lib/state/opportunity";

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const baseSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid("Pick a location."),
  type: z.string(),
  title: z.string().trim().min(4, "Give it a title providers will understand at a glance."),
  description: z.string().trim().max(5000).default(""),
  expectedVolume: z.string().trim().max(500).default(""),
  liabilityExpectations: z.string().trim().max(2000).default(""),
  notes: z.string().trim().max(2000).default(""),
  payKind: z.enum(["fixed", "range", "negotiable_min"]).or(z.literal("")),
  payUnit: z.enum(["hour", "day", "per_treatment", "commission_pct", "salary_year", "flat"]).or(z.literal("")),
  payMin: z.coerce.number().positive().optional(),
  payMax: z.coerce.number().positive().optional(),
  urgent: z.literal("on").optional(),
  supervisionAttested: z.literal("on").optional(),
  applicationDeadline: z.string().default(""),
  expiresAt: z.string().default(""),
  // Schedule (validated per type below).
  date: z.string().default(""),
  startTime: z.string().default(""),
  endTime: z.string().default(""),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  startDate: z.string().default(""),
  untilDate: z.string().default(""),
});

type FormValues = z.infer<typeof baseSchema>;

function fail(backTo: string, message: string): never {
  const sep = backTo.includes("?") ? "&" : "?";
  redirect(`${backTo}${sep}error=${encodeURIComponent(message)}`);
}

function parseForm(formData: FormData, backTo: string): FormValues {
  // Fields not rendered for this type arrive as null — normalize to "" so the
  // zod defaults (which only fire on undefined) aren't bypassed.
  const str = (name: string) => String(formData.get(name) ?? "");
  const parsed = baseSchema.safeParse({
    organizationId: formData.get("organizationId"),
    locationId: formData.get("locationId"),
    type: str("type"),
    title: str("title"),
    description: str("description"),
    expectedVolume: str("expectedVolume"),
    liabilityExpectations: str("liabilityExpectations"),
    notes: str("notes"),
    payKind: str("payKind"),
    payUnit: str("payUnit"),
    payMin: formData.get("payMin") || undefined,
    payMax: formData.get("payMax") || undefined,
    urgent: formData.get("urgent") ?? undefined,
    supervisionAttested: formData.get("supervisionAttested") ?? undefined,
    applicationDeadline: str("applicationDeadline"),
    expiresAt: str("expiresAt"),
    date: str("date"),
    startTime: str("startTime"),
    endTime: str("endTime"),
    daysOfWeek: formData.getAll("daysOfWeek"),
    startDate: str("startDate"),
    untilDate: str("untilDate"),
  });
  if (!parsed.success) fail(backTo, parsed.error.issues[0].message);
  return parsed.data;
}

interface PayColumns {
  payKind: "fixed" | "range" | "negotiable_min" | null;
  payUnit: "hour" | "day" | "per_treatment" | "commission_pct" | "salary_year" | "flat" | null;
  payMinCents: number | null;
  payMaxCents: number | null;
}

/** Mirrors opportunities_pay_visibility_check so users get words, not SQL errors. */
function validatePay(data: FormValues, payRequired: boolean, backTo: string): PayColumns {
  const hasAny = Boolean(data.payKind || data.payMin != null);
  if (!hasAny) {
    if (payRequired) {
      fail(backTo, "Pay is required for this type — fixed, a range, or a negotiable minimum. Hidden pay isn't allowed.");
    }
    return { payKind: null, payUnit: null, payMinCents: null, payMaxCents: null };
  }
  if (!data.payKind || !data.payUnit || data.payMin == null) {
    fail(backTo, "To show pay, set the structure, the unit, and at least the minimum.");
  }
  const min = Math.round(data.payMin * 100);
  const max = data.payMax != null ? Math.round(data.payMax * 100) : null;
  if (data.payKind === "range" && (max == null || max <= min)) {
    fail(backTo, "A pay range needs a maximum above the minimum.");
  }
  if (data.payKind !== "range" && max != null && max !== min) {
    fail(backTo, "Only a range has a maximum — clear the max or switch to a range.");
  }
  return {
    payKind: data.payKind,
    payUnit: data.payUnit,
    payMinCents: min,
    payMaxCents: data.payKind === "range" ? max : null,
  };
}

interface ScheduleColumns {
  recurrenceRule: string | null;
  recurrenceLocalStart: string | null;
  recurrenceDurationMin: number | null;
  recurrenceUntil: string | null;
}

function validateSchedule(
  data: FormValues,
  schedule: "one_time" | "recurring" | "none",
  timezone: string,
  backTo: string,
): ScheduleColumns {
  if (schedule === "none") {
    return { recurrenceRule: null, recurrenceLocalStart: null, recurrenceDurationMin: null, recurrenceUntil: null };
  }
  if (!HHMM.test(data.startTime) || !HHMM.test(data.endTime)) {
    fail(backTo, "Set the start and end times.");
  }
  if (schedule === "one_time") {
    if (!YMD.test(data.date)) fail(backTo, "Pick the date.");
    const start = DateTime.fromISO(`${data.date}T${data.startTime}`, { zone: timezone });
    if (start < DateTime.now().setZone(timezone)) {
      fail(backTo, "That date and start time are in the past.");
    }
    return { recurrenceRule: null, recurrenceLocalStart: null, recurrenceDurationMin: null, recurrenceUntil: null };
  }
  // recurring
  if (data.daysOfWeek.length === 0) fail(backTo, "Pick at least one day of the week.");
  if (!YMD.test(data.startDate)) fail(backTo, "Pick the first date of the series.");
  if (data.untilDate && (!YMD.test(data.untilDate) || data.untilDate < data.startDate)) {
    fail(backTo, "The end date must be on or after the start date.");
  }
  return {
    recurrenceRule: buildWeeklyRRule({ byDay: data.daysOfWeek, until: data.untilDate || null }),
    recurrenceLocalStart: data.startTime,
    recurrenceDurationMin: durationMinutes(data.startTime, data.endTime),
    recurrenceUntil: data.untilDate || null,
  };
}

/** Optional datetime-local strings, interpreted in the location's timezone. */
function localInstant(value: string, timezone: string): Date | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: timezone });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function getIds(formData: FormData, name: string): string[] {
  return formData.getAll(name).map(String).filter(Boolean);
}

/**
 * Injectable/laser/IV services (risk-tier-3 categories) require the
 * supervision attestation at post time (locked compliance decision).
 */
async function requiresAttestation(tx: Tx, serviceIds: string[]): Promise<boolean> {
  if (serviceIds.length === 0) return false;
  const rows = await tx
    .select({ riskTier: serviceCategories.riskTier })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(inArray(services.id, serviceIds));
  return rows.some((r) => r.riskTier >= 3);
}

/** Insert occurrences for the next MATERIALIZE_WEEKS. Idempotent (unique on opportunity+start). */
async function materializeOccurrences(
  tx: Tx,
  opp: {
    id: string;
    timezone: string;
    schedule: "one_time" | "recurring" | "none";
    date?: string;
    startTime?: string;
    endTime?: string;
    recurrenceRule: string | null;
    recurrenceLocalStart: string | null;
    recurrenceDurationMin: number | null;
    startDate?: string;
  },
  backTo: string,
): Promise<void> {
  if (opp.schedule === "none") return;

  let rows: { startsAt: Date; endsAt: Date }[] = [];
  if (opp.schedule === "one_time") {
    const occ = localOccurrence({
      date: opp.date!,
      startTime: opp.startTime!,
      endTime: opp.endTime!,
      timezone: opp.timezone,
    });
    if (!occ) fail(backTo, "We couldn't read that date and time — double-check them.");
    rows = [occ];
  } else {
    const now = new Date();
    rows = expandWeekly({
      rrule: opp.recurrenceRule!,
      localStart: opp.recurrenceLocalStart!,
      durationMin: opp.recurrenceDurationMin!,
      timezone: opp.timezone,
      seriesStart: opp.startDate!,
      windowStart: now,
      windowEnd: new Date(now.getTime() + MATERIALIZE_WEEKS * 7 * 24 * 60 * 60 * 1000),
    });
    if (rows.length === 0) {
      fail(backTo, "That pattern has no upcoming dates — check the days and the end date.");
    }
  }

  await tx
    .insert(opportunityOccurrences)
    .values(rows.map((r) => ({ opportunityId: opp.id, startsAt: r.startsAt, endsAt: r.endsAt })))
    .onConflictDoNothing();
}

async function setStatus(
  tx: Tx,
  oppId: string,
  from: OpportunityStatus,
  to: OpportunityStatus,
  extra: Partial<{ postedAt: Date; filledAt: Date }> = {},
): Promise<void> {
  assertOpportunityTransition(from, to);
  await tx
    .update(opportunities)
    .set({ status: to, ...extra })
    .where(and(eq(opportunities.id, oppId), eq(opportunities.status, from)));
}

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

export async function createOpportunityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const typeParam = String(formData.get("type") ?? "");
  const backTo = `/b/opportunities/new?type=${encodeURIComponent(typeParam)}`;

  const data = parseForm(formData, backTo);
  const meta = opportunityTypeMeta(data.type);
  if (!meta || meta.comingSoon) fail("/b/opportunities/new", "That opportunity type isn't available yet.");

  const serviceIds = getIds(formData, "serviceIds");
  const providerTypeIds = getIds(formData, "providerTypeIds");
  if (providerTypeIds.length === 0) fail(backTo, "Pick at least one provider type.");
  if (serviceIds.length === 0) fail(backTo, "Pick at least one service.");

  await requireOrgRole(data.organizationId, "poster");
  const pay = validatePay(data, meta.payRequired, backTo);
  const intent = String(formData.get("intent") ?? "draft");

  const oppId = await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [location] = await tx
      .select({ id: locations.id, timezone: locations.timezone })
      .from(locations)
      .where(and(eq(locations.id, data.locationId), eq(locations.organizationId, data.organizationId)));
    if (!location) fail(backTo, "Pick one of your locations.");

    const schedule = validateSchedule(data, meta.schedule, location.timezone, backTo);

    if ((await requiresAttestation(tx, serviceIds)) && data.supervisionAttested !== "on") {
      fail(backTo, "Injectable, laser, and IV services require the supervision attestation checkbox.");
    }

    const [opp] = await tx
      .insert(opportunities)
      .values({
        organizationId: data.organizationId,
        locationId: location.id,
        postedByUserId: user.id,
        type: data.type as never,
        title: data.title,
        description: data.description || null,
        expectedVolume: data.expectedVolume || null,
        liabilityExpectations: data.liabilityExpectations || null,
        notes: data.notes || null,
        ...pay,
        ...schedule,
        timezone: location.timezone,
        urgent: data.urgent === "on",
        supervisionAttestedAt: data.supervisionAttested === "on" ? new Date() : null,
        applicationDeadline: localInstant(data.applicationDeadline, location.timezone),
        expiresAt: localInstant(data.expiresAt, location.timezone),
      })
      .returning({ id: opportunities.id });

    await tx
      .insert(opportunityServices)
      .values(serviceIds.map((serviceId) => ({ opportunityId: opp.id, serviceId })));
    await tx
      .insert(opportunityProviderTypes)
      .values(providerTypeIds.map((providerTypeId) => ({ opportunityId: opp.id, providerTypeId })));

    await materializeOccurrences(
      tx,
      {
        id: opp.id,
        timezone: location.timezone,
        schedule: meta.schedule,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        recurrenceRule: schedule.recurrenceRule,
        recurrenceLocalStart: schedule.recurrenceLocalStart,
        recurrenceDurationMin: schedule.recurrenceDurationMin,
        startDate: data.startDate,
      },
      backTo,
    );

    if (intent === "post") {
      await setStatus(tx, opp.id, "draft", "posted", { postedAt: new Date() });
    }
    return opp.id;
  });

  if (intent === "post") {
    await tryEnqueue(() => enqueueFanoutPosted(oppId), "fanout-posted");
  }

  redirect(
    `/b/opportunities/${oppId}?notice=` +
      encodeURIComponent(intent === "post" ? "Posted — matching providers are being alerted." : "Draft saved."),
  );
}

export async function updateOpportunityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const oppId = String(formData.get("opportunityId") ?? "");
  if (!oppId) redirect("/b/opportunities");
  const backTo = `/b/opportunities/${oppId}/edit`;

  const data = parseForm(formData, backTo);
  await requireOrgRole(data.organizationId, "poster");

  const serviceIds = getIds(formData, "serviceIds");
  const providerTypeIds = getIds(formData, "providerTypeIds");
  if (providerTypeIds.length === 0) fail(backTo, "Pick at least one provider type.");
  if (serviceIds.length === 0) fail(backTo, "Pick at least one service.");

  let wasPosted = false;
  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [existing] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, oppId), eq(opportunities.organizationId, data.organizationId)));
    if (!existing) redirect("/b/opportunities");
    if (existing.status !== "draft" && existing.status !== "posted") {
      fail(`/b/opportunities/${oppId}`, "Only drafts and posted opportunities can be edited.");
    }
    wasPosted = existing.status === "posted";
    // The type is the form's skeleton — changing it is a new post.
    const meta = opportunityTypeMeta(existing.type)!;
    if (data.type !== existing.type) fail(backTo, "The type can't change — create a new opportunity instead.");

    const pay = validatePay(data, meta.payRequired, backTo);

    const [location] = await tx
      .select({ id: locations.id, timezone: locations.timezone })
      .from(locations)
      .where(and(eq(locations.id, data.locationId), eq(locations.organizationId, data.organizationId)));
    if (!location) fail(backTo, "Pick one of your locations.");

    const schedule = validateSchedule(data, meta.schedule, location.timezone, backTo);

    if ((await requiresAttestation(tx, serviceIds)) && data.supervisionAttested !== "on") {
      fail(backTo, "Injectable, laser, and IV services require the supervision attestation checkbox.");
    }

    await tx
      .update(opportunities)
      .set({
        locationId: location.id,
        title: data.title,
        description: data.description || null,
        expectedVolume: data.expectedVolume || null,
        liabilityExpectations: data.liabilityExpectations || null,
        notes: data.notes || null,
        ...pay,
        ...schedule,
        timezone: location.timezone,
        urgent: data.urgent === "on",
        supervisionAttestedAt:
          data.supervisionAttested === "on" ? (existing.supervisionAttestedAt ?? new Date()) : null,
        applicationDeadline: localInstant(data.applicationDeadline, location.timezone),
        expiresAt: localInstant(data.expiresAt, location.timezone),
      })
      .where(eq(opportunities.id, oppId));

    await tx.delete(opportunityServices).where(eq(opportunityServices.opportunityId, oppId));
    await tx
      .insert(opportunityServices)
      .values(serviceIds.map((serviceId) => ({ opportunityId: oppId, serviceId })));
    await tx.delete(opportunityProviderTypes).where(eq(opportunityProviderTypes.opportunityId, oppId));
    await tx
      .insert(opportunityProviderTypes)
      .values(providerTypeIds.map((providerTypeId) => ({ opportunityId: oppId, providerTypeId })));

    // Schedule edits regenerate FUTURE OPEN occurrences only — booked rows
    // (Phase 7) keep their reschedule flow; past rows are history.
    if (meta.schedule !== "none") {
      await tx
        .delete(opportunityOccurrences)
        .where(
          and(
            eq(opportunityOccurrences.opportunityId, oppId),
            eq(opportunityOccurrences.status, "open"),
            gt(opportunityOccurrences.startsAt, new Date()),
          ),
        );
      await materializeOccurrences(
        tx,
        {
          id: oppId,
          timezone: location.timezone,
          schedule: meta.schedule,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          recurrenceRule: schedule.recurrenceRule,
          recurrenceLocalStart: schedule.recurrenceLocalStart,
          recurrenceDurationMin: schedule.recurrenceDurationMin,
          startDate: data.startDate,
        },
        backTo,
      );
    }
  });

  // Material-edit policy lives in the worker: it re-alerts only on a grade
  // improvement or a ≥10% pay rise, so enqueueing every posted-edit is safe.
  if (wasPosted) {
    await tryEnqueue(() => enqueueFanoutUpdated(oppId), "fanout-updated");
  }

  redirect(`/b/opportunities/${oppId}?notice=` + encodeURIComponent("Changes saved."));
}

/* ------------------------------------------------------------------ */
/* Status moves                                                        */
/* ------------------------------------------------------------------ */

const statusMoveSchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

async function loadForMove(tx: Tx, organizationId: string, opportunityId: string) {
  const [opp] = await tx
    .select({ id: opportunities.id, status: opportunities.status })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
  if (!opp) redirect("/b/opportunities");
  return opp;
}

export async function postOpportunityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = statusMoveSchema.safeParse({
    organizationId: formData.get("organizationId"),
    opportunityId: formData.get("opportunityId"),
  });
  if (!parsed.success) redirect("/b/opportunities");
  const { organizationId, opportunityId } = parsed.data;
  await requireOrgRole(organizationId, "poster");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const opp = await loadForMove(tx, organizationId, opportunityId);
    try {
      await setStatus(tx, opp.id, opp.status, "posted", { postedAt: new Date() });
    } catch {
      fail(`/b/opportunities/${opportunityId}`, `Can't post from "${opp.status}".`);
    }
  });
  await tryEnqueue(() => enqueueFanoutPosted(opportunityId), "fanout-posted");
  redirect(
    `/b/opportunities/${opportunityId}?notice=` +
      encodeURIComponent("Posted — matching providers are being alerted."),
  );
}

export async function cancelOpportunityAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = statusMoveSchema.safeParse({
    organizationId: formData.get("organizationId"),
    opportunityId: formData.get("opportunityId"),
  });
  if (!parsed.success) redirect("/b/opportunities");
  const { organizationId, opportunityId } = parsed.data;
  await requireOrgRole(organizationId, "poster");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const opp = await loadForMove(tx, organizationId, opportunityId);
    try {
      await setStatus(tx, opp.id, opp.status, "canceled");
    } catch {
      fail(`/b/opportunities/${opportunityId}`, `Can't cancel from "${opp.status}".`);
    }
    // Open future occurrences die with the parent (kept as history, not deleted).
    await tx
      .update(opportunityOccurrences)
      .set({ status: "canceled" })
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, opportunityId),
          eq(opportunityOccurrences.status, "open"),
        ),
      );
  });
  redirect(`/b/opportunities/${opportunityId}?notice=` + encodeURIComponent("Opportunity canceled."));
}

/* ------------------------------------------------------------------ */
/* Occurrence-level edits                                              */
/* ------------------------------------------------------------------ */

const occurrenceMoveSchema = statusMoveSchema.extend({
  occurrenceId: z.string().uuid(),
});

async function loadOccurrence(tx: Tx, organizationId: string, opportunityId: string, occurrenceId: string) {
  const [row] = await tx
    .select({
      id: opportunityOccurrences.id,
      status: opportunityOccurrences.status,
      timezone: opportunities.timezone,
    })
    .from(opportunityOccurrences)
    .innerJoin(opportunities, eq(opportunities.id, opportunityOccurrences.opportunityId))
    .where(
      and(
        eq(opportunityOccurrences.id, occurrenceId),
        eq(opportunityOccurrences.opportunityId, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    );
  if (!row) redirect(`/b/opportunities/${opportunityId}`);
  return row;
}

export async function cancelOccurrenceAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = occurrenceMoveSchema.safeParse({
    organizationId: formData.get("organizationId"),
    opportunityId: formData.get("opportunityId"),
    occurrenceId: formData.get("occurrenceId"),
  });
  if (!parsed.success) redirect("/b/opportunities");
  const { organizationId, opportunityId, occurrenceId } = parsed.data;
  await requireOrgRole(organizationId, "poster");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const occ = await loadOccurrence(tx, organizationId, opportunityId, occurrenceId);
    assertOccurrenceTransition(occ.status, "canceled");
    await tx
      .update(opportunityOccurrences)
      .set({ status: "canceled" })
      .where(eq(opportunityOccurrences.id, occurrenceId));
  });
  redirect(`/b/opportunities/${opportunityId}?notice=` + encodeURIComponent("Date canceled."));
}

export async function rescheduleOccurrenceAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = occurrenceMoveSchema
    .extend({
      date: z.string().regex(YMD, "Pick the new date."),
      startTime: z.string().regex(HHMM, "Set the new start time."),
      endTime: z.string().regex(HHMM, "Set the new end time."),
    })
    .safeParse({
      organizationId: formData.get("organizationId"),
      opportunityId: formData.get("opportunityId"),
      occurrenceId: formData.get("occurrenceId"),
      date: formData.get("date"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
    });
  if (!parsed.success) redirect("/b/opportunities");
  const { organizationId, opportunityId, occurrenceId, date, startTime, endTime } = parsed.data;
  const backTo = `/b/opportunities/${opportunityId}`;
  await requireOrgRole(organizationId, "poster");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const occ = await loadOccurrence(tx, organizationId, opportunityId, occurrenceId);
    assertOccurrenceTransition(occ.status, "canceled");
    const next = localOccurrence({ date, startTime, endTime, timezone: occ.timezone });
    if (!next) fail(backTo, "We couldn't read the new date and time.");

    await tx
      .update(opportunityOccurrences)
      .set({ status: "canceled" })
      .where(eq(opportunityOccurrences.id, occurrenceId));
    await tx
      .insert(opportunityOccurrences)
      .values({
        opportunityId,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        rescheduledFromId: occurrenceId,
      })
      .onConflictDoNothing();
  });
  redirect(`${backTo}?notice=` + encodeURIComponent("Date rescheduled."));
}
