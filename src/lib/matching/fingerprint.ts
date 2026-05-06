/**
 * Counterparty → stable fingerprint used as the regex pattern for a
 * learned rule. The same merchant in a different city / terminal should
 * produce the same fingerprint so we don't fill match_rule with twenty
 * "AH AMSTERDAM NLD" / "AH UTRECHT NLD" / "AH ROTTERDAM NLD" entries.
 *
 * Steps, in order:
 *  1. Lowercase + collapse whitespace.
 *  2. Drop trailing card-sequence + terminal IDs.
 *  3. Drop trailing Dutch city tails (a known list + the literal NLD
 *     country tag).
 *  4. Drop trailing digit runs (e.g. "Albert Heijn 1234").
 *  5. Trim, then escape regex metachars so the result is safe to use
 *     directly in a Postgres `~*` regex.
 */

const DUTCH_CITY_TAILS = [
  "amsterdam",
  "rotterdam",
  "den haag",
  "the hague",
  "utrecht",
  "eindhoven",
  "groningen",
  "tilburg",
  "almere",
  "breda",
  "nijmegen",
  "haarlem",
  "arnhem",
  "zaanstad",
  "zaandam",
  "amersfoort",
  "haarlemmermeer",
  "s-hertogenbosch",
  "den bosch",
  "hoofddorp",
  "zwolle",
  "leiden",
  "leeuwarden",
  "delft",
  "alkmaar",
  "dordrecht",
  "venlo",
  "deventer",
  "apeldoorn",
  "maastricht",
  "alphen aan den rijn",
  "alphen",
  "schiphol",
];

const TERMINAL_PATTERNS: RegExp[] = [
  /\bterm:\s*\S+/gi,
  /\bterminal\s+\S+/gi,
  /\bbtr:\s*\S+/gi,
  /\bvolgnr:\s*\d+/gi,
  /\bpas\s*\d+/gi, // "Pas 003" — card sequence number
];

export function fingerprintCounterparty(raw: string): string {
  let s = raw.toLowerCase().replace(/\s+/g, " ").trim();

  // Drop terminal IDs anywhere in the string.
  for (const re of TERMINAL_PATTERNS) {
    s = s.replace(re, " ");
  }

  // Drop trailing "NLD" country tag and city tails (in either order).
  // Repeat a few times to handle patterns like "AH AMSTERDAM NLD" /
  // "AH NLD AMSTERDAM".
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/\bnld\b/g, " ");
    for (const city of DUTCH_CITY_TAILS) {
      s = s.replace(new RegExp(`\\b${escapeRegex(city)}\\b`, "g"), " ");
    }
    s = s.replace(/\s+/g, " ").trim();
    if (s === before) break;
  }

  // Strip trailing digit/whitespace runs ("Foobar 1234" → "foobar").
  s = s.replace(/[\s\d]+$/g, "");

  // Strip leading "AAB INZ " / similar bank-side prefixes that don't
  // identify the merchant.
  s = s.replace(/^(aab\s*inz\s*|inz\s*)/g, "");

  s = s.replace(/\s+/g, " ").trim();

  // Empty after stripping → fall back to the raw string lowercased.
  if (!s) s = raw.toLowerCase();

  return escapeRegex(s);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
