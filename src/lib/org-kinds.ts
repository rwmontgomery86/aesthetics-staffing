/** Business kinds — mirrors the comment on organizations.kind. Client-safe. */
export const ORG_KINDS = [
  ["med_spa", "Med spa"],
  ["spa", "Spa"],
  ["salon", "Salon"],
  ["derm_practice", "Dermatology practice"],
  ["plastic_surgery", "Plastic surgery practice"],
  ["wellness_clinic", "Wellness clinic"],
  ["massage_studio", "Massage studio"],
  ["makeup_event_co", "Makeup / event company"],
  ["training_center", "Training center"],
  ["other", "Other"],
] as const;

export type OrgKind = (typeof ORG_KINDS)[number][0];

export const ORG_KIND_VALUES = ORG_KINDS.map(([value]) => value);

export function orgKindLabel(kind: string): string {
  return ORG_KINDS.find(([value]) => value === kind)?.[1] ?? "Other";
}
