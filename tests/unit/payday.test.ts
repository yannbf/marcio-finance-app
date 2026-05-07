import { describe, expect, it } from "vitest";
import {
  daysUntilNextPayday,
  paydayMonthFor,
  paydayMonthForAnchor,
  shiftAnchor,
} from "@/lib/payday.ts";

describe("paydayMonthFor", () => {
  it("a date before payday belongs to the named month", () => {
    // 2026-05-06 with payday=25 → still inside the May payday-month
    // (Apr 25 → May 24).
    const range = paydayMonthFor(new Date(2026, 4, 6), 25); // May 6 2026
    expect(range.anchorYear).toBe(2026);
    expect(range.anchorMonth).toBe(5);
    expect(range.startsOn.getMonth()).toBe(3); // April (0-indexed)
    expect(range.startsOn.getDate()).toBe(25);
    expect(range.endsOn.getMonth()).toBe(4); // May
    expect(range.endsOn.getDate()).toBe(24);
  });

  it("a date on payday rolls into the next month", () => {
    // 2026-05-25 with payday=25 → June payday-month opens.
    const range = paydayMonthFor(new Date(2026, 4, 25), 25);
    expect(range.anchorYear).toBe(2026);
    expect(range.anchorMonth).toBe(6);
    expect(range.startsOn.getMonth()).toBe(4); // May
    expect(range.startsOn.getDate()).toBe(25);
  });

  it("the day before payday still belongs to the current month", () => {
    const range = paydayMonthFor(new Date(2026, 4, 24), 25);
    expect(range.anchorMonth).toBe(5);
  });

  it("January 1 wraps cleanly (anchor stays in Jan, range opens in Dec)", () => {
    const range = paydayMonthFor(new Date(2026, 0, 1), 25);
    expect(range.anchorYear).toBe(2026);
    expect(range.anchorMonth).toBe(1);
    expect(range.startsOn.getFullYear()).toBe(2025);
    expect(range.startsOn.getMonth()).toBe(11); // December
    expect(range.startsOn.getDate()).toBe(25);
  });

  it("December 25 rolls into the January-of-next-year payday-month", () => {
    const range = paydayMonthFor(new Date(2026, 11, 25), 25);
    expect(range.anchorYear).toBe(2027);
    expect(range.anchorMonth).toBe(1);
  });

  it("respects a custom payday day", () => {
    // payday=1: a date past day 1 always rolls forward — "today" of the
    // 15th sits in the next payday-month, which is June.
    const range = paydayMonthFor(new Date(2026, 4, 15), 1);
    expect(range.anchorYear).toBe(2026);
    expect(range.anchorMonth).toBe(6);
    // payday=15, date 2026-05-10 → still inside May.
    const r2 = paydayMonthFor(new Date(2026, 4, 10), 15);
    expect(r2.anchorMonth).toBe(5);
  });

  it("Feb 29 in a leap year resolves cleanly", () => {
    // 2024 is a leap year. Feb 29 with payday=25 → already past payday →
    // March payday-month.
    const range = paydayMonthFor(new Date(2024, 1, 29), 25);
    expect(range.anchorYear).toBe(2024);
    expect(range.anchorMonth).toBe(3);
  });

  it("payday=28 stays safe across short months", () => {
    // Feb 27 with payday=28 → still inside the Feb payday-month.
    const r1 = paydayMonthFor(new Date(2027, 1, 27), 28);
    expect(r1.anchorMonth).toBe(2);
    // Feb 28 → opens March payday-month.
    const r2 = paydayMonthFor(new Date(2027, 1, 28), 28);
    expect(r2.anchorMonth).toBe(3);
  });
});

describe("paydayMonthForAnchor", () => {
  it("round-trips from explicit anchor coordinates", () => {
    const r = paydayMonthForAnchor(2026, 7, 25);
    expect(r.anchorYear).toBe(2026);
    expect(r.anchorMonth).toBe(7);
  });

  it("preserves January wrap behavior", () => {
    const r = paydayMonthForAnchor(2026, 1, 25);
    expect(r.anchorYear).toBe(2026);
    expect(r.anchorMonth).toBe(1);
    expect(r.startsOn.getFullYear()).toBe(2025);
    expect(r.startsOn.getMonth()).toBe(11);
  });
});

describe("shiftAnchor", () => {
  it("walks forward inside the same year", () => {
    expect(shiftAnchor(2026, 5, 1)).toEqual({ year: 2026, month: 6 });
  });
  it("walks backward inside the same year", () => {
    expect(shiftAnchor(2026, 5, -1)).toEqual({ year: 2026, month: 4 });
  });
  it("crosses December → January", () => {
    expect(shiftAnchor(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it("crosses January → December", () => {
    expect(shiftAnchor(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it("handles delta = 0", () => {
    expect(shiftAnchor(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });
});

describe("daysUntilNextPayday", () => {
  it("counts whole days between today and the anchor's payday", () => {
    // 2026-05-06 with payday=25 → next payday lands on 2026-05-25.
    const days = daysUntilNextPayday(new Date(2026, 4, 6, 12, 0, 0), 25);
    expect(days).toBe(19);
  });

  it("rolls to the next month's payday once payday has passed", () => {
    // 00:00 on payday-day itself → payday-month already advanced, so the
    // "next payday" is roughly one month away. The exact count depends on
    // the calendar (28-31 days), so just assert it's a full-cycle value.
    const days = daysUntilNextPayday(new Date(2026, 4, 25, 0, 0, 0), 25);
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(33);
  });

  it("never returns a negative number", () => {
    // Any random sample inside the year stays non-negative.
    for (const day of [1, 5, 15, 24, 25, 26, 28]) {
      const d = daysUntilNextPayday(new Date(2026, 6, day), 25);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});
