/**
 * Status state machines (NotifEyes pattern): a transition table plus
 * assertTransition(), called by EVERY mutating action before it writes a
 * status. Postgres enums stop invalid values; this stops invalid moves.
 */

export type OpportunityStatus = "draft" | "posted" | "filled" | "expired" | "canceled" | "archived";

export type OccurrenceStatus = "open" | "booked" | "completed" | "canceled";

const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  draft: ["posted", "canceled", "archived"],
  posted: ["filled", "expired", "canceled", "archived"],
  // filled → posted when a booking cancellation reopens slots (Phase 7);
  // expired → posted when the business extends the deadline and re-posts.
  filled: ["posted", "canceled", "archived"],
  expired: ["posted", "archived"],
  canceled: ["archived"],
  archived: [],
};

const OCCURRENCE_TRANSITIONS: Record<OccurrenceStatus, OccurrenceStatus[]> = {
  open: ["booked", "completed", "canceled"],
  booked: ["completed", "canceled"], // Phase 7
  completed: [],
  canceled: [],
};

export function assertOpportunityTransition(from: OpportunityStatus, to: OpportunityStatus): void {
  if (!OPPORTUNITY_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid opportunity status transition: ${from} → ${to}`);
  }
}

export function assertOccurrenceTransition(from: OccurrenceStatus, to: OccurrenceStatus): void {
  if (!OCCURRENCE_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid occurrence status transition: ${from} → ${to}`);
  }
}
