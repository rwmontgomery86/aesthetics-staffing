/**
 * Every matching threshold in one place (MATCHING_LOGIC.md) — tune without
 * code archaeology. Client-safe constants.
 */
export const MATCHING = {
  /** Pay NEAR floor: comparable pay ≥ 85% of the zone's minimum. */
  payTolerance: 0.85,
  /** Service-overlap NEAR floor: |opp ∩ provider| / |opp| ≥ 0.5. */
  serviceRatioNear: 0.5,
  /** Schedule criterion looks at occurrences in the next N days. */
  scheduleHorizonDays: 30,
  /** Schedule PASS: at least this share of horizon occurrences fit. */
  scheduleFitShare: 0.5,
  /** Schedule NEAR: an occurrence fits within this slack of the window edges. */
  nearWindowSlackMin: 60,
  /** Hour↔day pay conversion convention (flagged "approximate" in alerts). */
  hoursPerDay: 8,
  /** Re-alert triggers when pay rises at least this much vs the alerted snapshot. */
  realertPayIncrease: 1.1,
  /** Urgent SMS forcing: first open occurrence starts within this window. */
  urgentSmsWindowHours: 24,
} as const;
