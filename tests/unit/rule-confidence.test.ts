import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_FLOOR,
  computeRuleConfidence,
} from "@/lib/matching/rule-confidence.ts";

describe("computeRuleConfidence", () => {
  it("returns the prior when there are no observations", () => {
    expect(computeRuleConfidence(0, 0)).toBeCloseTo(0.7, 5);
  });

  it("walks toward 1 with confirmations", () => {
    const a = computeRuleConfidence(1, 0);
    const b = computeRuleConfidence(5, 0);
    const c = computeRuleConfidence(50, 0);
    expect(a).toBeGreaterThan(0.7);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(0.99);
  });

  it("walks toward 0 with overrides", () => {
    const a = computeRuleConfidence(0, 1);
    const b = computeRuleConfidence(0, 5);
    const c = computeRuleConfidence(0, 50);
    expect(a).toBeLessThan(0.7);
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
    expect(c).toBeGreaterThanOrEqual(0.05);
  });

  it("clamps to [0.05, 0.99]", () => {
    expect(computeRuleConfidence(0, 1_000_000)).toBeGreaterThanOrEqual(0.05);
    expect(computeRuleConfidence(1_000_000, 0)).toBeLessThanOrEqual(0.99);
  });

  it("a rule with many overrides falls below the floor", () => {
    // 0 confirmed, 12 overridden — strong negative signal.
    const c = computeRuleConfidence(0, 12);
    expect(c).toBeLessThan(CONFIDENCE_FLOOR);
  });

  it("a few confirmations recover trust above the floor", () => {
    const c = computeRuleConfidence(3, 0);
    expect(c).toBeGreaterThan(CONFIDENCE_FLOOR);
  });

  it("balanced confirmation/override stays around the prior", () => {
    const c = computeRuleConfidence(5, 5);
    // Drifting toward 0.5 but the prior keeps it above.
    expect(c).toBeGreaterThan(0.4);
    expect(c).toBeLessThan(0.7);
  });
});

describe("CONFIDENCE_FLOOR", () => {
  it("is exposed as a stable export the matching engine can import", () => {
    expect(typeof CONFIDENCE_FLOOR).toBe("number");
    expect(CONFIDENCE_FLOOR).toBeGreaterThan(0);
    expect(CONFIDENCE_FLOOR).toBeLessThan(1);
  });
});
