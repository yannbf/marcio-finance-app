/**
 * Bayesian-ish confidence update for learned match rules.
 *
 * Each rule starts with a prior (BASE_PRIOR), gets bumped toward 1 every
 * time the user confirms its prediction, and bumped toward 0 every time
 * the user overrides it. PRIOR_WEIGHT controls how quickly real
 * observations move the score off the prior — higher means slower.
 *
 * Formula:
 *   conf = (BASE_PRIOR * PRIOR_WEIGHT + confirmed) /
 *          (PRIOR_WEIGHT + confirmed + overridden)
 *
 * Clamped to [0.05, 0.99] to avoid disappearing entirely or pretending
 * to be infallible.
 *
 * The engine's lower threshold (CONFIDENCE_FLOOR) controls when a rule
 * is dropped from consideration — a rule that's been overridden a lot
 * stops auto-matching but still exists in the DB so the user can review
 * (Tier 2 §5 in future-features.md).
 */

const BASE_PRIOR = 0.7;
const PRIOR_WEIGHT = 4;
export const CONFIDENCE_FLOOR = 0.4;

export function computeRuleConfidence(
  confirmedHits: number,
  overriddenHits: number,
): number {
  const num = BASE_PRIOR * PRIOR_WEIGHT + confirmedHits;
  const den = PRIOR_WEIGHT + confirmedHits + overriddenHits;
  const raw = den > 0 ? num / den : BASE_PRIOR;
  return Math.max(0.05, Math.min(0.99, raw));
}
