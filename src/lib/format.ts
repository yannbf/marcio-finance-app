/**
 * Currency is always EUR for v1 — both partners live in NL and the joint
 * account is a Dutch checking account. Formatting respects the locale
 * and always renders cents — the household wants the exact cent value
 * everywhere, no rounding to whole euros.
 */
export function formatEUR(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Alias kept for places that explicitly want cents-precision; behaves
 * identically to {@link formatEUR} now that the headline formatter
 * also keeps cents.
 */
export function formatEURPrecise(value: number, locale: string): string {
  return formatEUR(value, locale);
}

export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Short month + day (e.g. "May 14" / "14 mai."). Used for the "as of"
 * date next to a synced bank balance.
 */
export function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}
