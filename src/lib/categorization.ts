/**
 * Automatic transaction subcategorization.
 *
 * Sits ALONGSIDE the user's budget-item taxonomy — it's a curated
 * NL-flavoured taxonomy ("groceries", "restaurants", "leisure", …)
 * that classifies a transaction purely from its counterparty +
 * description, no schema or learned rules involved. Useful when the
 * user wants to know "where my money went" in everyday language
 * rather than in their own (sometimes idiosyncratic) sheet rows.
 *
 * Independent from `match_rule` / `seed-rules.ts`:
 *   - Those route a tx to a budget_item the user owns.
 *   - This labels a tx with a high-level spending category we ship.
 *
 * Pattern order matters — first match wins. Keep specific regexes
 * (named brands) ABOVE broad keyword fallbacks.
 */

export const CATEGORY_KEYS = [
  "groceries",
  "restaurants",
  "transport",
  "shopping",
  "leisure",
  "utilities",
  "healthcare",
  "subscriptions",
  "housing",
  "taxes",
  "finance",
  "other",
] as const;

export type Category = (typeof CATEGORY_KEYS)[number];

type CategoryRule = { pattern: RegExp; category: Category };

const RULES: CategoryRule[] = [
  // ─── Groceries / supermarkets / drugstores ─────────────────────────
  {
    pattern:
      /albert\s*heijn|\bah\b\s*(?:to\s*go|amsterdam|rotterdam|utrecht|den\s*haag|hoofddorp|amersfoort)|\bjumbo\b|\blidl\b|\baldi\b|\bdirk\b\s*(?:vd|van)|hoogvliet|deen\s*supermarkt|\bplus\s*supermarkt|\bspar\b|\bekoplaza\b|marqt|kruidvat|\betos\b|trekpleister|\bdrogist\b/i,
    category: "groceries",
  },

  // ─── Restaurants / cafes / takeaway ────────────────────────────────
  {
    pattern:
      /restaurant|\bcafe\b|\bbar\b|\bbistro\b|brasserie|trattoria|pizz(?:a|eria)|burger|kebab|sushi|ramen|noodle|\bfalafel\b|shoarma|takeaway|thuisbezorgd|deliveroo|uber\s*eats|just\s*eat|mcdonald|burger\s*king|\bkfc\b|subway|\bdomino\b|new\s*york\s*pizza|starbucks|coffee\s*comp|coffee\s*lab|\bespresso\b|\blatte\b|patisserie|gelateria|gelato|ijssalon|bakkerij|bakery|\bsnackbar\b|cafetaria|lunchroom|\bfebo\b|\bvapiano\b|\bnando|\bwagamama|sumup\s*\*|ccv\*\s*ummah|ccv\*/i,
    category: "restaurants",
  },

  // ─── Transport ─────────────────────────────────────────────────────
  {
    pattern:
      /\bovpay\b|ov-?chip|ov-?fiets|\bgvb\b|\bns\s*groep|ns\s*reizigers|\bns\b\s*(?:retail|stations)|connexxion|arriva|\bret\s*rotterdam|\bhtm\s*personenvervoer|qbuzz|keolis|uber\s*(?!eats)|\bbolt\b|\bfree\s*now|\bstaxi\b|amsterdam\s*airport|schiphol|park(?:ing|eren)|\bq-?park\b|interparking|shell|\besso\b|\bbp\b\s*(?:retail|station)|tinq\b|tankstation|tankstelle|fastned|allego|gas\s*station|\bcar\s*sharing|greenwheels|cabify|share\s*now|sixt/i,
    category: "transport",
  },

  // ─── Online shopping / general retail ──────────────────────────────
  {
    pattern:
      /\bbol\.?com\b|coolblue|amazon\.|\baliexpress\b|\btemu\b|zalando|wehkamp|\bhema\b|\baction\b|bijenkorf|primark|\bc&a\b|\bh&m\b|\bzara\b|\bmango\b|\bnike\b|adidas|decathlon|intersport|mediamarkt|bcc\s*elektronica|\bhomedepot\b|\bikea\b|leen\s*bakker|loods\s*5|gamma|karwei|praxis|tuinland|fonq|ebay|\betsy\b/i,
    category: "shopping",
  },

  // ─── Leisure / entertainment / travel / sports ─────────────────────
  {
    pattern:
      /netflix|spotify|disney\+?|disneyplus|youtube\s*premium|prime\s*video|\bhbo\b|paramount|videoland|\bcinema\b|\bpathe\b|kinepolis|\btheater\b|\bbioscoop\b|festival|\bconcert\b|ticketmaster|\bticketswap\b|\bvideoland\b|fitness|basicfit|david\s*lloyd|sportcity|\byoga\b|crossfit|\bgym\b|\bsport(?:school|park)|\bzwembad\b|squash|tennis|padel|\bski\b|\bgolf\b|escape\s*room|museum|expo|airbnb|booking\.com|booking\.nl|hotel\b|hostel\b|\bflight\b|\bklm\b|transavia|ryanair|easyjet|\btui\b|expedia|trip\.com|kiwi\.com/i,
    category: "leisure",
  },

  // ─── Utilities (energy, water, telecom, internet) ──────────────────
  {
    pattern:
      /vattenfall|eneco|essent|\bnuon\b|greenchoice|engie|oxxio|budget\s*energie|water\s*(?:nl|ned)|waternet|evides|\bpwn\b|\bdunea\b|\bkpn\b|ziggo|\bt-?mobile\b|tele2|odido|simyo|vodafone|\borange\b|liander|enexis|stedin|cogas/i,
    category: "utilities",
  },

  // ─── Healthcare / insurance / pharmacy ─────────────────────────────
  {
    pattern:
      /apotheek|pharmacy|tandarts|dentist|huisarts|fysio|fyziotherapie|psycholoog|ziekenhuis|hospital|\bumc\b|\bvgz\b|zilveren\s*kruis|\bmenzis\b|\bcz\b\s*(?:zorg|verzekeraar)|achmea|\bfbto\b|\bonvz\b|\bdsw\b|salud|zorg(?:verzekeraar|polis|verzekering)/i,
    category: "healthcare",
  },

  // ─── Subscriptions (digital services / software) ───────────────────
  {
    pattern:
      /apple\.?com\/?bill|apple\s*icloud|\bicloud\b|google\s*(?:play|one|storage|cloud)|\badobe\b|github|notion|figma|openai|chatgpt|anthropic|\bclaude\b|microsoft|office\s*365|onedrive|dropbox|\bslack\b|patreon|substack|linkedin\s*premium|grammarly|nordvpn|expressvpn|protonmail|\b1password\b|jetbrains|\bvercel\b/i,
    category: "subscriptions",
  },

  // ─── Housing (rent, mortgage) ──────────────────────────────────────
  {
    pattern:
      /hypothe?ek|\bhuur\b|\brent\b|woningstichting|woonstichting|vastgoed|\bvve\b|\bvereniging\s*van\s*eigenaren|nuts\s*partner/i,
    category: "housing",
  },

  // ─── Taxes / government / fines ────────────────────────────────────
  {
    pattern:
      /belastingdienst|gemeente\s*\w+|belastingen|\bcjib\b|kamer\s*van\s*koophandel|\bkvk\b|notaris|\briv\s*-?\s*nl|\brdw\b/i,
    category: "taxes",
  },

  // ─── Banking fees / financial services ─────────────────────────────
  {
    pattern:
      /\bing\s*(?:kosten|basic|plus)|kosten\s*oranjepakket|kosten\s*account|kosten\s*betaalpakket|service\s*fee|abn\s*amro\s*kosten|rabobank\s*kosten|\bsns\s*bank\b\s*kosten|\bbunq\b\s*kosten|bank\s*charge|wise\s*fee|\binwiss?elen|exchange\s*fee/i,
    category: "finance",
  },
];

/**
 * Classify a transaction by its visible text. First matching rule
 * wins; falls back to "other" so the breakdown always sums.
 */
export function categorizeTx(row: {
  counterparty: string | null;
  description: string | null;
}): Category {
  const haystack = `${row.counterparty ?? ""} ${row.description ?? ""}`;
  for (const r of RULES) {
    if (r.pattern.test(haystack)) return r.category;
  }
  return "other";
}

/** Stable order for rendering. Most-common first feels right. */
export const CATEGORY_DISPLAY_ORDER: Category[] = [
  "groceries",
  "restaurants",
  "transport",
  "leisure",
  "shopping",
  "utilities",
  "healthcare",
  "subscriptions",
  "housing",
  "taxes",
  "finance",
  "other",
];
