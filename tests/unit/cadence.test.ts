import { describe, expect, it } from "vitest";
import { monthlyContributionCents } from "@/lib/cadence.ts";

describe("monthlyContributionCents", () => {
  it("divides SAZONAIS yearly amounts by 12", () => {
    expect(monthlyContributionCents(-120000, "SAZONAIS")).toBe(-10000);
    expect(monthlyContributionCents(-240000, "SAZONAIS")).toBe(-20000);
  });

  it("rounds awkward divisions instead of truncating", () => {
    // -100 / 12 = -8.333… → Math.round → -8.
    expect(monthlyContributionCents(-100, "SAZONAIS")).toBe(-8);
  });

  it("passes monthly sections through unchanged", () => {
    for (const section of [
      "FIXAS",
      "VARIAVEIS",
      "DIVIDAS",
      "ENTRADAS",
      "ECONOMIAS",
    ] as const) {
      expect(monthlyContributionCents(-12345, section)).toBe(-12345);
      expect(monthlyContributionCents(99999, section)).toBe(99999);
    }
  });

  it("handles zero", () => {
    expect(monthlyContributionCents(0, "SAZONAIS")).toBe(0);
    expect(monthlyContributionCents(0, "FIXAS")).toBe(0);
  });

  it("handles positive yearly inflows (should be rare but valid)", () => {
    expect(monthlyContributionCents(120000, "SAZONAIS")).toBe(10000);
  });
});
