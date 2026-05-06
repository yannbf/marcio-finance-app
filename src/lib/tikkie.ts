/**
 * Pull a friendly person name out of a Tikkie transaction.
 *
 * ING surfaces Tikkie payments two ways:
 *   - Counterparty "<Name> via Tikkie" — name is right there.
 *   - Counterparty "AAB INZ TIKKIE" — generic; description has either
 *     "Van <Name>," or the merchant/event description before the name.
 */
export const TIKKIE_COUNTERPARTY = /\btikkie\b|aab\s*inz\s*tikkie/i;

/**
 * Postgres-flavored equivalent. JS `\b` becomes backspace under POSIX
 * regex (which is what `~*` runs); Postgres uses `\y` for word
 * boundaries. We also can't trust `\s` to mean what JS does, so this
 * pattern is conservative — it just looks for the literal "tikkie".
 */
export const TIKKIE_PG_PATTERN = "tikkie";

export function isTikkie(row: {
  counterparty: string | null;
  description: string | null;
}): boolean {
  const text = `${row.counterparty ?? ""} ${row.description ?? ""}`;
  return TIKKIE_COUNTERPARTY.test(text);
}

export function parseTikkiePerson(
  counterparty: string | null,
  description: string | null,
): string {
  const cp = (counterparty ?? "").trim();
  const viaMatch = cp.match(/^(.+?)\s+via\s+tikkie$/i);
  if (viaMatch) return cleanName(viaMatch[1]!);

  const desc = description ?? "";
  // "Van Hr G Hengeveld," or "Van I RODRIGUES TEIXEIRA,"
  const vanMatch = desc.match(/\bVan\s+([^,]+),/i);
  if (vanMatch) return cleanName(vanMatch[1]!);

  return "—";
}

function cleanName(raw: string): string {
  return raw
    .replace(/\b(hr|mw|mevr|dhr|de heer|mevrouw)\b\.?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
