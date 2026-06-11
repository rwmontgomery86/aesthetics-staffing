/**
 * Opportunity type metadata — drives the picker, the form's conditional
 * sections, and validation. Client-safe (no server imports).
 *
 * `schedule` controls which schedule fields the form shows and whether
 * occurrences are materialized; `payRequired` mirrors the DB CHECK
 * (opportunities_pay_visibility_check): the shift family can never post
 * hidden pay. For the rest, pay is encouraged but optional (decision B.9).
 */

export interface OpportunityTypeMeta {
  value: string;
  label: string;
  description: string;
  schedule: "one_time" | "recurring" | "none";
  payRequired: boolean;
  comingSoon?: boolean;
}

export const OPPORTUNITY_TYPES: OpportunityTypeMeta[] = [
  {
    value: "one_time_shift",
    label: "One-time shift",
    description: "A single day of coverage — vacation, sick day, event overflow.",
    schedule: "one_time",
    payRequired: true,
  },
  {
    value: "recurring_shift",
    label: "Recurring shift",
    description: "A repeating weekly pattern — every Monday and Wednesday, 9 to 5.",
    schedule: "recurring",
    payRequired: true,
  },
  {
    value: "popup_event",
    label: "Pop-up event",
    description: "A one-day event needing extra hands — trunk show, bridal party, festival.",
    schedule: "one_time",
    payRequired: true,
  },
  {
    value: "contract",
    label: "Contract",
    description: "A fixed engagement — maternity coverage, a season, a project.",
    schedule: "none",
    payRequired: true,
  },
  {
    value: "part_time",
    label: "Part-time role",
    description: "An ongoing part-time position on your team.",
    schedule: "none",
    payRequired: false,
  },
  {
    value: "full_time",
    label: "Full-time role",
    description: "An ongoing full-time position on your team.",
    schedule: "none",
    payRequired: false,
  },
  {
    value: "evergreen",
    label: "Evergreen application",
    description: "Always accepting applications — build a bench for future openings.",
    schedule: "none",
    payRequired: false,
  },
  {
    value: "training_event",
    label: "Training event",
    description: "Host a class or certification course.",
    schedule: "one_time",
    payRequired: false,
    comingSoon: true,
  },
  {
    value: "room_rental",
    label: "Room / chair rental",
    description: "Rent a room or chair to an independent provider.",
    schedule: "none",
    payRequired: false,
    comingSoon: true,
  },
];

export function opportunityTypeMeta(value: string): OpportunityTypeMeta | undefined {
  return OPPORTUNITY_TYPES.find((t) => t.value === value);
}

export function opportunityTypeLabel(value: string): string {
  return opportunityTypeMeta(value)?.label ?? value;
}

export const PAY_UNIT_LABELS: Record<string, string> = {
  hour: "per hour",
  day: "per day",
  per_treatment: "per treatment",
  commission_pct: "% commission",
  salary_year: "per year",
  flat: "flat",
};

/** "$45–$55 per hour" · "From $45 per hour (negotiable)" · "40% commission". */
export function formatPay(opp: {
  payKind: string | null;
  payUnit: string | null;
  payMinCents: number | null;
  payMaxCents: number | null;
}): string | null {
  if (opp.payKind == null || opp.payMinCents == null || opp.payUnit == null) return null;
  const unit = PAY_UNIT_LABELS[opp.payUnit] ?? opp.payUnit;
  const fmt = (cents: number) =>
    opp.payUnit === "commission_pct"
      ? `${cents / 100}%`
      : `$${(cents / 100).toLocaleString("en-US", {
          minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        })}`;
  if (opp.payUnit === "commission_pct") {
    return opp.payKind === "range" && opp.payMaxCents != null
      ? `${fmt(opp.payMinCents)}–${fmt(opp.payMaxCents)} commission`
      : `${fmt(opp.payMinCents)} commission`;
  }
  switch (opp.payKind) {
    case "range":
      return `${fmt(opp.payMinCents)}–${fmt(opp.payMaxCents ?? opp.payMinCents)} ${unit}`;
    case "negotiable_min":
      return `From ${fmt(opp.payMinCents)} ${unit} (negotiable)`;
    default:
      return `${fmt(opp.payMinCents)} ${unit}`;
  }
}

export const OPPORTUNITY_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  posted: "Posted",
  filled: "Filled",
  expired: "Expired",
  canceled: "Canceled",
  archived: "Archived",
};
