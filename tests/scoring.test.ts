import { describe, expect, it } from "vitest";
import {
  combineGrade,
  comparablePayCents,
  scorePay,
  scoreSchedule,
  scoreServices,
  type OccurrenceWindow,
} from "@/lib/matching/score";

/**
 * Phase 6 exit criterion: the scoring suite covers the MATCHING_LOGIC §2
 * threshold table and the §8 edge cases. All pure functions — no DB.
 */

const TZ = "America/New_York";

/** Tue Jun 16 2026 9 AM–5 PM ET (a fixed, DST-stable reference occurrence). */
function occ(dateIso: string, startHour: number, hours: number): OccurrenceWindow {
  const start = new Date(`${dateIso}T${String(startHour).padStart(2, "0")}:00:00-04:00`);
  return { startsAt: start, endsAt: new Date(start.getTime() + hours * 3600_000) };
}

describe("pay criterion", () => {
  const floor = { minPayCents: 10000, minPayUnit: "hour" }; // $100/h

  it("PASS at or above the floor; no floor or no pay auto-PASS", () => {
    expect(scorePay({ payKind: "fixed", payUnit: "hour", payMinCents: 10000, payMaxCents: null }, floor).verdict).toBe("pass");
    expect(scorePay({ payKind: "fixed", payUnit: "hour", payMinCents: 4000, payMaxCents: null }, { minPayCents: null, minPayUnit: "hour" }).verdict).toBe("pass");
    expect(scorePay({ payKind: null, payUnit: null, payMinCents: null, payMaxCents: null }, floor).verdict).toBe("pass");
  });

  it("range compares best case (max)", () => {
    expect(scorePay({ payKind: "range", payUnit: "hour", payMinCents: 8000, payMaxCents: 12000 }, floor).verdict).toBe("pass");
  });

  it("NEAR in [85%, 100%) — and negotiable_min gets the negotiable note", () => {
    const at85 = scorePay({ payKind: "fixed", payUnit: "hour", payMinCents: 8500, payMaxCents: null }, floor);
    expect(at85.verdict).toBe("near");
    const neg = scorePay({ payKind: "negotiable_min", payUnit: "hour", payMinCents: 9000, payMaxCents: null }, floor);
    expect(neg.verdict).toBe("near");
    expect(neg.note).toMatch(/negotiable/);
  });

  it("FAIL below 85%", () => {
    expect(scorePay({ payKind: "fixed", payUnit: "hour", payMinCents: 8499, payMaxCents: null }, floor).verdict).toBe("fail");
  });

  it("hour↔day uses the 8-hour convention and flags it approximate", () => {
    // $850/day vs $100/h floor → 850/8 = $106.25/h → PASS with approx note.
    const dayPay = scorePay({ payKind: "fixed", payUnit: "day", payMinCents: 85000, payMaxCents: null }, floor);
    expect(dayPay.verdict).toBe("pass");
    expect(dayPay.note).toMatch(/approximate/);
    // $40/h vs $400/day floor → 40*8 = $320/day = 80% → FAIL.
    expect(comparablePayCents({ payKind: "fixed", payUnit: "hour", payMinCents: 4000, payMaxCents: null }, "day")).toBe(32000);
    expect(scorePay({ payKind: "fixed", payUnit: "hour", payMinCents: 4000, payMaxCents: null }, { minPayCents: 40000, minPayUnit: "day" }).verdict).toBe("fail");
  });

  it("incomparable units NEVER silently fail — NEAR with explicit copy", () => {
    const commission = scorePay({ payKind: "fixed", payUnit: "commission_pct", payMinCents: 4000, payMaxCents: null }, floor);
    expect(commission.verdict).toBe("near");
    expect(commission.note).toMatch(/pay structure differs/);
    expect(scorePay({ payKind: "fixed", payUnit: "salary_year", payMinCents: 9000000, payMaxCents: null }, floor).verdict).toBe("near");
    expect(scorePay({ payKind: "fixed", payUnit: "per_treatment", payMinCents: 15000, payMaxCents: null }, floor).verdict).toBe("near");
  });
});

describe("services criterion", () => {
  const provider = new Set(["a", "b"]);

  it("PASS at full coverage, NEAR at ≥50% with ≥1, FAIL below", () => {
    expect(scoreServices(["a", "b"], provider).verdict).toBe("pass");
    expect(scoreServices(["a", "c"], provider).verdict).toBe("near"); // 1/2
    expect(scoreServices(["a", "c", "d"], provider).verdict).toBe("fail"); // 1/3
    expect(scoreServices(["c", "d"], provider).verdict).toBe("fail"); // 0/2
  });

  it("empty opportunity service list auto-PASSes", () => {
    expect(scoreServices([], provider).verdict).toBe("pass");
  });
});

describe("schedule criterion", () => {
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  // Mon Jun 15 + Wed Jun 17 + Fri Jun 19 2026, 9 AM–5 PM ET.
  const weekday9to5 = [occ("2026-06-15", 9, 8), occ("2026-06-17", 9, 8), occ("2026-06-19", 9, 8)];

  it("no-schedule types auto-PASS (null), empty horizon FAILs", () => {
    expect(scoreSchedule(null, TZ, { daysOfWeek: allDays, timeStartLocal: null, timeEndLocal: null }, []).verdict).toBe("pass");
    expect(scoreSchedule([], TZ, { daysOfWeek: allDays, timeStartLocal: null, timeEndLocal: null }, []).verdict).toBe("fail");
  });

  it("PASS when ≥50% of occurrences fit days + window", () => {
    const zone = { daysOfWeek: [1, 3], timeStartLocal: "08:00", timeEndLocal: "18:00" }; // Mon+Wed
    expect(scoreSchedule(weekday9to5, TZ, zone, []).verdict).toBe("pass"); // 2 of 3
  });

  it("NEAR when at least one fits but under half", () => {
    const zone = { daysOfWeek: [5], timeStartLocal: null, timeEndLocal: null }; // Fri only → 1 of 3
    const score = scoreSchedule(weekday9to5, TZ, zone, []);
    expect(score.verdict).toBe("near");
  });

  it("NEAR via ±60 min window slack; FAIL beyond it", () => {
    // Window 10:00–17:00: a 9 AM start misses by exactly 60 min → slack NEAR.
    const slackZone = { daysOfWeek: allDays, timeStartLocal: "10:00", timeEndLocal: "17:00" };
    const justOutside = scoreSchedule([occ("2026-06-15", 9, 8)], TZ, slackZone, []);
    expect(justOutside.verdict).toBe("near");
    expect(justOutside.note).toMatch(/outside your time window/);
    // Window 11:00–17:00: misses by 2h even with slack → FAIL.
    expect(
      scoreSchedule([occ("2026-06-15", 9, 8)], TZ, { daysOfWeek: allDays, timeStartLocal: "11:00", timeEndLocal: "17:00" }, []).verdict,
    ).toBe("fail");
  });

  it("midnight-wrapping zone window (22:00–06:00) fits an overnight shift", () => {
    const nightZone = { daysOfWeek: allDays, timeStartLocal: "22:00", timeEndLocal: "06:00" };
    const overnight = [occ("2026-06-15", 23, 6)]; // 11 PM–5 AM
    expect(scoreSchedule(overnight, TZ, nightZone, []).verdict).toBe("pass");
    expect(scoreSchedule([occ("2026-06-15", 9, 8)], TZ, nightZone, []).verdict).toBe("fail");
  });

  it("availability template: empty = no constraint; non-empty needs overlap", () => {
    const zone = { daysOfWeek: allDays, timeStartLocal: null, timeEndLocal: null };
    const monMorning = [{ dayOfWeek: 1, timeStart: "08:00", timeEnd: "12:00" }];
    // Mon 9–5 overlaps the 8–12 block → fits.
    expect(scoreSchedule([occ("2026-06-15", 9, 8)], TZ, zone, monMorning).verdict).toBe("pass");
    // Wed has no block → that occurrence doesn't fit.
    expect(scoreSchedule([occ("2026-06-17", 9, 8)], TZ, zone, monMorning).verdict).toBe("fail");
  });
});

describe("grade combination", () => {
  const pass = { verdict: "pass" as const };
  const near = { verdict: "near" as const };
  const fail = { verdict: "fail" as const };

  it("all PASS → exact; any NEAR (no FAIL) → close; any FAIL → no alert", () => {
    expect(combineGrade({ pay: pass, services: pass, schedule: pass })).toBe("exact");
    expect(combineGrade({ pay: near, services: pass, schedule: pass })).toBe("close");
    expect(combineGrade({ pay: pass, services: near, schedule: near })).toBe("close");
    expect(combineGrade({ pay: fail, services: pass, schedule: pass })).toBeNull();
    expect(combineGrade({ pay: near, services: fail, schedule: pass })).toBeNull();
  });
});
