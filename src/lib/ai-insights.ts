/**
 * Hardcoded "AI insights" — short, opinionated takes on the
 * household's data, authored by Claude when the user asks for an
 * investigation. Each entry is pinned in source so adding / editing /
 * removing one is a one-PR review (no admin DB, no ML pipeline).
 *
 * Workflow:
 *   - User: "Investigate my supermarket spend last 3 months"
 *   - Claude reads the data via the dev DB / Chrome MCP / etc.
 *   - Claude appends a new entry to `AI_INSIGHTS` at the TOP and
 *     commits.
 *   - The /insights screen shows it in the AIInsightsCard.
 *
 * Insights expire — once a finding is no longer relevant (the user
 * fixed it, or the month rolled), delete the entry instead of
 * letting it stale-pile.
 *
 * Voice: speak directly to the household ("vocês"), short sentences,
 * no hedging — these are calls-to-attention, not academic
 * disclaimers. Single-language is fine; pick whatever fits the
 * data better and stay consistent within a single insight body.
 */

export type InsightTone = "info" | "tip" | "warn" | "celebrate";

export type AIInsight = {
  /** Unique stable id; lowercase-kebab. Doesn't need to be sortable. */
  id: string;
  tone: InsightTone;
  /** One-line headline, ≤60 chars to fit a single phone-screen line. */
  title: string;
  /** 1-3 short sentences. Plain text, no markdown. */
  body: string;
  /** Optional in-app deep link the user can tap to investigate further. */
  link?: { href: string; label: string };
  /** ISO date the insight was authored. Drives display order: newest first. */
  authoredAt: string;
};

/**
 * Newest insights at the TOP. Older entries should be removed when
 * they stop being useful — leaving stale insights around erodes
 * trust in the live ones.
 */
export const AI_INSIGHTS: AIInsight[] = [
  // Stub so the empty state isn't the only thing the user sees on
  // first deploy — replace this with real findings as soon as Claude
  // looks at the data.
  {
    id: "intro-stub",
    tone: "info",
    title: "Aqui é onde análises do Marcio aparecem",
    body: "Peça para o Claude investigar um padrão (ex.: 'olha quanto a gente gastou em mercado nos últimos 3 meses') e a observação aparece aqui — pinada no código, sem persistência em banco.",
    authoredAt: "2026-05-10",
  },
];
