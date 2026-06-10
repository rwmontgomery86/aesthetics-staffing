import { like } from "drizzle-orm";
import { serviceDb } from "../service";
import {
  credentialRequirements,
  credentialTypes,
  providerTypes,
  serviceCategories,
  services,
} from "../schema";

/**
 * Credential types + Georgia credential requirements.
 *
 * ⚠️ EVERY requirement row here is DRAFT — pending attorney validation against
 * actual Georgia rules (COMPLIANCE_AND_TRUST.md §8). The DRAFT marker in
 * `notes` is load-bearing: re-seeding deletes and reinserts exactly the rows
 * carrying it, and the UI may surface the draft status internally.
 *
 * Known modeling limitation (flagged in OPEN_QUESTIONS): requirements are
 * AND-semantics; "esthetician OR master cosmetologist" can't be expressed yet,
 * so the alternative license is noted in `notes` for the attorney pass.
 */

const DRAFT = "DRAFT — pending attorney validation (COMPLIANCE_AND_TRUST.md §8)";

export async function seedCredentials() {
  const typeRows = [
    { slug: "rn_license", name: "Registered Nurse (RN) License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "aprn_license", name: "APRN / Nurse Practitioner License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "pa_license", name: "Physician Assistant License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "md_do_license", name: "Physician (MD/DO) License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "esthetician_license", name: "Esthetician License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "master_cosmetologist_license", name: "Master Cosmetologist License", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "lmt_license", name: "Licensed Massage Therapist (LMT)", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: true },
    { slug: "cpr_bls", name: "CPR / BLS Certification", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: false },
    { slug: "liability_insurance", name: "Professional Liability Insurance", requiresDocument: true, requiresExpiry: true, requiresLicenseNumber: false },
    { slug: "neurotoxin_training_cert", name: "Neurotoxin Training Certificate", requiresDocument: true, requiresExpiry: false, requiresLicenseNumber: false },
    { slug: "filler_training_cert", name: "Dermal Filler Training Certificate", requiresDocument: true, requiresExpiry: false, requiresLicenseNumber: false },
    { slug: "laser_training_cert", name: "Laser Device Training Certificate", requiresDocument: true, requiresExpiry: false, requiresLicenseNumber: false },
    { slug: "iv_certification", name: "IV Therapy Certification", requiresDocument: true, requiresExpiry: false, requiresLicenseNumber: false },
    { slug: "pmu_certification", name: "Permanent Makeup / Microblading Certification", requiresDocument: true, requiresExpiry: false, requiresLicenseNumber: false },
  ];
  for (const row of typeRows) {
    await serviceDb
      .insert(credentialTypes)
      .values(row)
      .onConflictDoUpdate({ target: credentialTypes.slug, set: row });
  }

  const [allCredTypes, allProviderTypes, allCategories, allServices] = await Promise.all([
    serviceDb.select().from(credentialTypes),
    serviceDb.select().from(providerTypes),
    serviceDb.select().from(serviceCategories),
    serviceDb.select().from(services),
  ]);
  const cred = (slug: string) => {
    const f = allCredTypes.find((r) => r.slug === slug);
    if (!f) throw new Error(`missing credential type ${slug}`);
    return f.id;
  };
  const ptype = (slug: string) => {
    const f = allProviderTypes.find((r) => r.slug === slug);
    if (!f) throw new Error(`missing provider type ${slug}`);
    return f.id;
  };
  const cat = (slug: string) => {
    const f = allCategories.find((r) => r.slug === slug);
    if (!f) throw new Error(`missing category ${slug}`);
    return f.id;
  };
  const svc = (slug: string) => {
    const f = allServices.find((r) => r.slug === slug);
    if (!f) throw new Error(`missing service ${slug}`);
    return f.id;
  };

  // Idempotency: drop and reinsert exactly the DRAFT rows.
  await serviceDb.delete(credentialRequirements).where(like(credentialRequirements.notes, "DRAFT%"));

  type Req = typeof credentialRequirements.$inferInsert;
  const rows: Req[] = [
    // ── Provider-type base licensure (GA) ──────────────────────────────────
    { credentialTypeId: cred("rn_license"), providerTypeId: ptype("injector_rn"), state: "GA", level: "required", notes: DRAFT },
    { credentialTypeId: cred("aprn_license"), providerTypeId: ptype("injector_np"), state: "GA", level: "required", notes: DRAFT },
    { credentialTypeId: cred("pa_license"), providerTypeId: ptype("injector_pa"), state: "GA", level: "required", notes: DRAFT },
    { credentialTypeId: cred("md_do_license"), providerTypeId: ptype("injector_md_do"), state: "GA", level: "required", notes: DRAFT },
    {
      credentialTypeId: cred("esthetician_license"),
      providerTypeId: ptype("aesthetician"),
      state: "GA",
      level: "required",
      notes: `${DRAFT} — a GA master cosmetologist license also satisfies this; OR-semantics pending (OPEN_QUESTIONS).`,
    },
    { credentialTypeId: cred("lmt_license"), providerTypeId: ptype("massage_therapist"), state: "GA", level: "required", notes: DRAFT },

    // ── Category-level (GA) ────────────────────────────────────────────────
    { credentialTypeId: cred("cpr_bls"), serviceCategoryId: cat("injectables"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("liability_insurance"), serviceCategoryId: cat("injectables"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("laser_training_cert"), serviceCategoryId: cat("laser_energy"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("iv_certification"), serviceCategoryId: cat("iv_wellness"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("cpr_bls"), serviceCategoryId: cat("iv_wellness"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("liability_insurance"), serviceCategoryId: cat("massage_bodywork"), state: "GA", level: "recommended", notes: DRAFT },

    // ── Service-level (GA) ─────────────────────────────────────────────────
    { credentialTypeId: cred("neurotoxin_training_cert"), serviceId: svc("neurotoxin"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("filler_training_cert"), serviceId: svc("dermal_filler"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("filler_training_cert"), serviceId: svc("lip_filler"), state: "GA", level: "recommended", notes: DRAFT },
    { credentialTypeId: cred("pmu_certification"), serviceId: svc("pmu_microblading"), state: "GA", level: "recommended", notes: DRAFT },
  ];
  await serviceDb.insert(credentialRequirements).values(rows);

  console.log(`✓ credentials: ${typeRows.length} types, ${rows.length} DRAFT GA requirement rows`);
}

if (process.argv[1]?.endsWith("credentials.ts")) {
  seedCredentials().then(() => process.exit(0));
}
