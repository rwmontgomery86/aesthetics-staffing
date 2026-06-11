import { describe, expect, it } from "vitest";
import {
  buildWeeklyRRule,
  durationMinutes,
  expandWeekly,
  localOccurrence,
  parseWeeklyRRule,
} from "@/lib/recurrence";
import {
  assertOccurrenceTransition,
  assertOpportunityTransition,
} from "@/lib/state/opportunity";

/**
 * Phase 5 exit criterion: occurrence expansion is DST-safe across both the
 * spring and fall boundaries. America/New_York 2026: spring-forward on
 * March 8, fall-back on November 1.
 */

const TZ = "America/New_York";

describe("weekly RRULE build/parse", () => {
  it("round-trips days and UNTIL", () => {
    const rrule = buildWeeklyRRule({ byDay: [3, 1], until: "2026-08-01" });
    expect(rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260801");
    expect(parseWeeklyRRule(rrule)).toEqual({ byDay: [1, 3], until: "2026-08-01" });
  });

  it("rejects empty or out-of-range days and non-weekly rules", () => {
    expect(() => buildWeeklyRRule({ byDay: [], until: null })).toThrow();
    expect(() => buildWeeklyRRule({ byDay: [7], until: null })).toThrow();
    expect(() => parseWeeklyRRule("FREQ=DAILY")).toThrow(/only FREQ=WEEKLY/);
  });
});

describe("expandWeekly across DST boundaries", () => {
  const base = {
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
    localStart: "09:00",
    durationMin: 480,
    timezone: TZ,
  };

  it("spring forward: 9 AM local stays 9 AM local while the UTC offset moves", () => {
    const occ = expandWeekly({
      ...base,
      seriesStart: "2026-03-02",
      windowStart: new Date("2026-03-02T00:00:00-05:00"),
      windowEnd: new Date("2026-03-13T00:00:00-04:00"),
    });
    // Mon Mar 2, Wed Mar 4 (EST, UTC-5) then Mon Mar 9, Wed Mar 11 (EDT, UTC-4).
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-03-02T14:00:00.000Z",
      "2026-03-04T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
      "2026-03-11T13:00:00.000Z",
    ]);
    // Duration is fixed real time on both sides of the jump.
    for (const o of occ) {
      expect(o.endsAt.getTime() - o.startsAt.getTime()).toBe(480 * 60 * 1000);
    }
  });

  it("fall back: same local hour, offset returns to EST", () => {
    const occ = expandWeekly({
      ...base,
      seriesStart: "2026-10-26",
      windowStart: new Date("2026-10-26T00:00:00-04:00"),
      windowEnd: new Date("2026-11-04T00:00:00-05:00"),
    });
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-10-26T13:00:00.000Z", // Mon, EDT
      "2026-10-28T13:00:00.000Z", // Wed, EDT
      "2026-11-02T14:00:00.000Z", // Mon, EST
    ]);
  });

  it("respects UNTIL and seriesStart", () => {
    const occ = expandWeekly({
      ...base,
      rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260309",
      seriesStart: "2026-03-02",
      windowStart: new Date("2026-02-01T00:00:00-05:00"),
      windowEnd: new Date("2026-05-01T00:00:00-04:00"),
    });
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-03-02T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
  });

  it("a shift spanning the spring-forward jump keeps its real duration", () => {
    const occ = expandWeekly({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      localStart: "23:00",
      durationMin: 480,
      timezone: TZ,
      seriesStart: "2026-03-07",
      windowStart: new Date("2026-03-07T00:00:00-05:00"),
      windowEnd: new Date("2026-03-08T00:00:00-05:00"),
    });
    expect(occ).toHaveLength(1);
    // Sat 11 PM EST + 8 real hours crosses 2 AM → clocks read 8 AM EDT.
    expect(occ[0].startsAt.toISOString()).toBe("2026-03-08T04:00:00.000Z");
    expect(occ[0].endsAt.toISOString()).toBe("2026-03-08T12:00:00.000Z");
    expect(occ[0].endsAt.getTime() - occ[0].startsAt.getTime()).toBe(480 * 60 * 1000);
  });
});

describe("localOccurrence", () => {
  it("converts a local date+times to UTC instants", () => {
    const occ = localOccurrence({ date: "2026-06-15", startTime: "09:00", endTime: "17:00", timezone: TZ });
    expect(occ?.startsAt.toISOString()).toBe("2026-06-15T13:00:00.000Z");
    expect(occ?.endsAt.toISOString()).toBe("2026-06-15T21:00:00.000Z");
  });

  it("end at or before start wraps to the next day (overnight shift)", () => {
    const occ = localOccurrence({ date: "2026-06-15", startTime: "22:00", endTime: "06:00", timezone: TZ });
    expect(occ?.endsAt.toISOString()).toBe("2026-06-16T10:00:00.000Z");
    expect(durationMinutes("22:00", "06:00")).toBe(480);
  });
});

describe("status state machines", () => {
  it("allows the documented opportunity lifecycle", () => {
    expect(() => assertOpportunityTransition("draft", "posted")).not.toThrow();
    expect(() => assertOpportunityTransition("posted", "filled")).not.toThrow();
    expect(() => assertOpportunityTransition("posted", "canceled")).not.toThrow();
    expect(() => assertOpportunityTransition("expired", "posted")).not.toThrow();
  });

  it("rejects invalid moves", () => {
    expect(() => assertOpportunityTransition("canceled", "posted")).toThrow(/Invalid/);
    expect(() => assertOpportunityTransition("archived", "draft")).toThrow(/Invalid/);
    expect(() => assertOpportunityTransition("draft", "filled")).toThrow(/Invalid/);
    expect(() => assertOccurrenceTransition("completed", "open")).toThrow(/Invalid/);
    expect(() => assertOccurrenceTransition("canceled", "booked")).toThrow(/Invalid/);
  });
});
