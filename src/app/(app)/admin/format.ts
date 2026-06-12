import { DateTime } from "luxon";

/** Timestamps reach the admin pages in three shapes: Dates (drizzle selects),
 *  ISO strings (date columns), and pg wire format with a space + offset
 *  ("2026-06-10 13:51:16.32-04" — what raw tx.execute() returns for
 *  timestamptz, found in the Phase 9 walkthrough). Accept all three. */
export type Ts = string | Date;

export function ts(value: Ts): DateTime {
  if (value instanceof Date) return DateTime.fromJSDate(value);
  const iso = DateTime.fromISO(value);
  return iso.isValid ? iso : DateTime.fromSQL(value);
}
