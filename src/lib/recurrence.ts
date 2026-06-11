import { DateTime } from "luxon";

/**
 * Recurrence engine. Opportunities store an RFC 5545 RRULE string
 * (recurrence_rule) plus a local start time, duration, and the location's
 * IANA timezone; this module builds those strings from the weekly builder UI
 * and expands them into concrete UTC instants.
 *
 * Scope is deliberately the WEEKLY subset the builder can author
 * (FREQ=WEEKLY;BYDAY=...[;UNTIL=...]) — we only ever parse strings we wrote.
 * Expansion walks calendar days in the LOCATION's timezone and converts each
 * local start to UTC through luxon, so DST is resolved exactly once, at
 * generation: a 9 AM Monday shift is 9 AM local on both sides of a spring or
 * fall boundary, even though the UTC offset changes.
 */

/** Day-of-week ints use the Postgres EXTRACT(DOW) convention: 0=Sunday … 6=Saturday. */
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** Rolling materialization horizon (the Phase 6 cron extends it weekly). */
export const MATERIALIZE_WEEKS = 8;

export interface WeeklyRule {
  /** 0=Sunday … 6=Saturday, sorted, deduped. */
  byDay: number[];
  /** Last date (inclusive, local calendar date YYYY-MM-DD) or null for ongoing. */
  until: string | null;
}

export function buildWeeklyRRule(rule: WeeklyRule): string {
  const days = [...new Set(rule.byDay)].sort((a, b) => a - b);
  if (days.length === 0 || days.some((d) => d < 0 || d > 6)) {
    throw new Error("Weekly recurrence needs at least one valid day of week.");
  }
  const parts = [`FREQ=WEEKLY`, `BYDAY=${days.map((d) => RRULE_DAYS[d]).join(",")}`];
  if (rule.until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.until)) {
      throw new Error("UNTIL must be a YYYY-MM-DD date.");
    }
    parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  }
  return parts.join(";");
}

export function parseWeeklyRRule(rrule: string): WeeklyRule {
  const fields = new Map(
    rrule.split(";").map((part) => {
      const [key, value] = part.split("=");
      return [key?.toUpperCase() ?? "", value ?? ""] as const;
    }),
  );
  if (fields.get("FREQ") !== "WEEKLY") {
    throw new Error(`Unsupported RRULE (only FREQ=WEEKLY is materialized): ${rrule}`);
  }
  const byDay = (fields.get("BYDAY") ?? "")
    .split(",")
    .filter(Boolean)
    .map((code) => RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number]))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  if (byDay.length === 0) {
    throw new Error(`RRULE has no parseable BYDAY: ${rrule}`);
  }
  const untilRaw = fields.get("UNTIL");
  const until = untilRaw
    ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
    : null;
  return { byDay, until };
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

/**
 * One concrete occurrence from a local date + times. End at or before start
 * means the shift runs overnight into the next day. Returns null for
 * unparseable input (the zod layer should have caught it).
 */
export function localOccurrence(input: {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  timezone: string;
}): Occurrence | null {
  const start = DateTime.fromISO(`${input.date}T${input.startTime}`, { zone: input.timezone });
  let end = DateTime.fromISO(`${input.date}T${input.endTime}`, { zone: input.timezone });
  if (!start.isValid || !end.isValid) return null;
  if (end <= start) end = end.plus({ days: 1 });
  return { startsAt: start.toUTC().toJSDate(), endsAt: end.toUTC().toJSDate() };
}

export function durationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes > 0 ? minutes : minutes + 24 * 60; // overnight wraps
}

/**
 * Expand a weekly rule into occurrences whose LOCAL start date falls in
 * [windowStart, windowEnd) — both interpreted in the rule's timezone.
 * Duration is fixed minutes from the local start, so a shift spanning a DST
 * jump keeps its booked length (the wall-clock end shifts, the hours don't).
 */
export function expandWeekly(input: {
  rrule: string;
  localStart: string; // HH:MM
  durationMin: number;
  timezone: string;
  /** First local calendar date eligible (series start), YYYY-MM-DD. */
  seriesStart: string;
  windowStart: Date;
  windowEnd: Date;
}): Occurrence[] {
  const rule = parseWeeklyRRule(input.rrule);
  const zone = input.timezone;

  let cursor = DateTime.max(
    DateTime.fromISO(input.seriesStart, { zone }).startOf("day"),
    DateTime.fromJSDate(input.windowStart, { zone }).startOf("day"),
  );
  const windowEndLocal = DateTime.fromJSDate(input.windowEnd, { zone });
  const untilEnd = rule.until
    ? DateTime.fromISO(rule.until, { zone }).endOf("day")
    : null;

  const [hour, minute] = input.localStart.split(":").map(Number);
  const occurrences: Occurrence[] = [];

  while (cursor < windowEndLocal && (!untilEnd || cursor <= untilEnd)) {
    if (rule.byDay.includes(cursor.weekday % 7)) {
      // set() resolves nonexistent local times (spring-forward gap) by
      // shifting into the valid offset — DST handled here, exactly once.
      const start = cursor.set({ hour, minute, second: 0, millisecond: 0 });
      if (start >= DateTime.fromJSDate(input.windowStart, { zone }) && start < windowEndLocal) {
        occurrences.push({
          startsAt: start.toUTC().toJSDate(),
          endsAt: start.plus({ minutes: input.durationMin }).toUTC().toJSDate(),
        });
      }
    }
    cursor = cursor.plus({ days: 1 });
  }
  return occurrences;
}
