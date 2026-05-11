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
  {
    id: "other-bucket-loud-2026-05",
    tone: "warn",
    title: "€3,481 caíram em 'Other' nos últimos 3 meses",
    body: "Yann pessoal: €1,670 (35 transações). Conjunta: €1,810 (7 transações). Tudo que cai em Other é gasto sem uma linha equivalente na planilha — bom sinal para criar linhas novas no próximo mês.",
    link: { href: "/transactions?show=matched", label: "Ver transações" },
    authoredAt: "2026-05-11",
  },
  {
    id: "nn-recurring-fixed-2026-05",
    tone: "tip",
    title: "NN Schadeverzekering parece uma FIXAS escondida",
    body: "Cobrada todo mês na conta do Yann (~€12-25). É seguro de responsabilidade civil junto com o ING. Crie uma linha 'Seguro responsabilidade' em FIXAS pessoal pra tirar isso do Other.",
    authoredAt: "2026-05-11",
  },
  {
    id: "jas-rijschool-sazonais-2026-05",
    tone: "tip",
    title: "Aulas de direção (€734 em 2 meses) merecem linha SAZONAIS",
    body: "Jas Rijschool já tomou €734 em fev+mar 2026, e pelo padrão deve continuar. Adicione 'Aulas de direção Camila' em SAZONAIS conjunta — assim aparece no plano mensal (1/12) e vocês veem o quanto falta pra terminar.",
    authoredAt: "2026-05-11",
  },
  {
    id: "tikkie-net-out-2026-05",
    tone: "info",
    title: "Saldo Tikkie: vocês pagaram €208 a mais que receberam",
    body: "Nos últimos 120 dias: €369 pagos a amigos via Tikkie, €161 recebidos. Net –€208. Não é problema — é o ritmo normal de rachar conta — mas vale lembrar que esses €208 saíram do Saídas casal sem aparecer como rolê próprio.",
    link: { href: "/tikkie", label: "Ver detalhe Tikkie" },
    authoredAt: "2026-05-11",
  },
  {
    id: "ikea-x2o-renovation-2026-05",
    tone: "info",
    title: "IKEA + X2O Badkamers = €497 — reforma de banheiro?",
    body: "Duas compras grandes em fevereiro: IKEA (€211) e X2O Badkamers (€286). Se for projeto único, deixe em Other mesmo. Se virar recorrente, abra uma linha SAZONAIS 'Reforma 2026' pra acompanhar o gasto total.",
    authoredAt: "2026-05-11",
  },
];
