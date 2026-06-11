/**
 * Application status machine (NotifEyes assertTransition pattern; the legal
 * moves come from USER_FLOWS §7/§9 and DATABASE_SCHEMA §applications).
 *
 * Direct submitted → offered/accepted is deliberate (low-friction selection);
 * declined/withdrawn/expired are terminal exits from any pre-accepted state.
 * Who may perform a move is the action's job (provider withdraws/accepts,
 * business offers/declines, the system expires) — this table only answers
 * whether the move exists.
 */
export type ApplicationStatus =
  | "submitted"
  | "viewed"
  | "shortlisted"
  | "offered"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "expired";

const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  submitted: ["viewed", "shortlisted", "offered", "accepted", "declined", "withdrawn", "expired"],
  viewed: ["shortlisted", "offered", "accepted", "declined", "withdrawn", "expired"],
  shortlisted: ["offered", "accepted", "declined", "withdrawn", "expired"],
  offered: ["accepted", "declined", "withdrawn", "expired"],
  accepted: [],
  declined: [],
  withdrawn: [],
  expired: [],
};

export function assertApplicationTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!APPLICATION_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid application status transition: ${from} → ${to}`);
  }
}

export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}
