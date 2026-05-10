/**
 * Decide whether a freshly-discovered Enable Banking account belongs
 * to the connecting user alone or to the joint household.
 *
 * Enable Banking returns `name` as the holder line (often the user's
 * full legal name OR — when both partners are on the account — a
 * comma-/ampersand-separated list). It also returns `product` which
 * sometimes literally says "Joint" / "Shared". We default to joint
 * whenever any of those signals is present so the user doesn't have
 * to manually flip the bank-account ownership pill on every connect
 * (which is the bug that silently broke seed-rule matching for the
 * household: every joint-scoped rule dropped out for a personal-
 * tagged joint account).
 */

const MULTI_HOLDER_SIGNALS: RegExp[] = [
  // Comma-separated names — the most common ING shape for joint
  // accounts: "Y Bezerra Braga Ferreira,C Ferrer Bezerra Loureiro".
  /,/,
  // Ampersand — "Yann & Camila".
  /&/,
  // Slash — "Yann / Camila".
  /\s\/\s/,
  // " e " / " and " between two capitalized fragments. The leading
  // capital on both sides reduces false positives like "Yann and
  // partners B.V." (a company).
  /[A-Z][a-zA-Z'À-ſ-]+\s+(?:e|and)\s+[A-Z][a-zA-Z'À-ſ-]+/,
];

const PRODUCT_JOINT_HINT = /\bjoint\b|\bshared\b|gezamenlijk|en\/of/i;

export type OwnerInferenceInput = {
  /** The connecting user's role — used as the default. */
  fallback: "yann" | "camila";
  /** Account holder name from Enable Banking. */
  name?: string | null;
  /** Account product name. */
  product?: string | null;
  /** ASPSP-provided account type / cash type. */
  accountType?: string | null;
};

export function inferAccountOwner(
  input: OwnerInferenceInput,
): "joint" | "yann" | "camila" {
  const name = (input.name ?? "").trim();
  const product = (input.product ?? "").trim();
  const accountType = (input.accountType ?? "").trim();

  if (name && MULTI_HOLDER_SIGNALS.some((re) => re.test(name))) {
    return "joint";
  }
  if (product && PRODUCT_JOINT_HINT.test(product)) {
    return "joint";
  }
  if (accountType && PRODUCT_JOINT_HINT.test(accountType)) {
    return "joint";
  }
  return input.fallback;
}
