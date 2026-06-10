import { describe, expect, it } from "vitest";
import {
  deriveExpiry,
  summarizeRequirements,
  type CredentialInput,
} from "@/lib/credentials/requirements";

const TODAY = new Date("2026-06-10T12:00:00");

const cred = (overrides: Partial<CredentialInput>): CredentialInput => ({
  id: "cred-1",
  credentialTypeId: "rn",
  status: "self_attested",
  expiresAt: null,
  ...overrides,
});

describe("deriveExpiry (never stored — computed from expires_at)", () => {
  it("null date → no derived state", () => {
    expect(deriveExpiry(null, TODAY)).toBeNull();
  });
  it("past date → expired", () => {
    expect(deriveExpiry("2026-06-09", TODAY)).toBe("expired");
  });
  it("today → expiring_soon, not expired", () => {
    expect(deriveExpiry("2026-06-10", TODAY)).toBe("expiring_soon");
  });
  it("within 30 days → expiring_soon", () => {
    expect(deriveExpiry("2026-07-09", TODAY)).toBe("expiring_soon");
  });
  it("beyond 30 days → fine", () => {
    expect(deriveExpiry("2026-08-15", TODAY)).toBeNull();
  });
});

describe("summarizeRequirements (union + strictest level)", () => {
  it("required beats recommended when both attach the same credential type", () => {
    const chips = summarizeRequirements(
      [
        { credentialTypeId: "cpr", level: "recommended" },
        { credentialTypeId: "cpr", level: "required" },
        { credentialTypeId: "cpr", level: "recommended" },
      ],
      [],
      TODAY,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].level).toBe("required");
    expect(chips[0].isWarning).toBe(true); // required + not provided
  });

  it("required + missing/rejected/expired warns; provided does not", () => {
    const chips = summarizeRequirements(
      [
        { credentialTypeId: "missing", level: "required" },
        { credentialTypeId: "rejected", level: "required" },
        { credentialTypeId: "expired", level: "required" },
        { credentialTypeId: "ok-attested", level: "required" },
        { credentialTypeId: "recommended-missing", level: "recommended" },
      ],
      [
        cred({ id: "c1", credentialTypeId: "rejected", status: "rejected_needs_info" }),
        cred({ id: "c2", credentialTypeId: "expired", status: "admin_reviewed", expiresAt: "2026-01-01" }),
        cred({ id: "c3", credentialTypeId: "ok-attested", status: "self_attested" }),
      ],
      TODAY,
    );
    const byType = Object.fromEntries(chips.map((chip) => [chip.credentialTypeId, chip]));
    expect(byType["missing"].isWarning).toBe(true);
    expect(byType["rejected"].isWarning).toBe(true);
    expect(byType["expired"].isWarning).toBe(true); // even admin-reviewed: expired = warn
    expect(byType["expired"].derived).toBe("expired");
    expect(byType["ok-attested"].isWarning).toBe(false); // warn-don't-block: self-attested counts
    expect(byType["recommended-missing"].isWarning).toBe(false); // recommended never warns
  });

  it("held-but-not-required credentials appear with level null and never warn", () => {
    const chips = summarizeRequirements(
      [],
      [cred({ credentialTypeId: "extra", status: "needs_review" })],
      TODAY,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].level).toBeNull();
    expect(chips[0].isWarning).toBe(false);
  });

  it("sorts warnings first, then required, recommended, extras", () => {
    const chips = summarizeRequirements(
      [
        { credentialTypeId: "rec", level: "recommended" },
        { credentialTypeId: "req-ok", level: "required" },
        { credentialTypeId: "req-missing", level: "required" },
      ],
      [
        cred({ id: "a", credentialTypeId: "req-ok", status: "self_attested" }),
        cred({ id: "b", credentialTypeId: "extra", status: "self_attested" }),
      ],
      TODAY,
    );
    expect(chips.map((chip) => chip.credentialTypeId)).toEqual([
      "req-missing",
      "req-ok",
      "rec",
      "extra",
    ]);
  });
});
