import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, desc, eq, inArray, or, ilike, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { ActivityRow } from "@/components/marcio/activity-row.tsx";
import type { BudgetItemOption } from "@/components/marcio/inbox-row.tsx";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { Locale } from "@/i18n/routing.ts";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Transactions");
  const tSections = await getTranslations("Sections");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();
  const sp = await searchParams;

  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];
  const filterText = (sp.q ?? "").trim();
  const show = (sp.show ?? "all") as "all" | "matched" | "unmatched";

  const filters = [inArray(bankAccount.owner, allowed)];
  if (filterText) {
    const like = `%${filterText.toLowerCase()}%`;
    filters.push(
      or(
        ilike(transaction.counterparty, like),
        ilike(transaction.description, like),
      )!,
    );
  }
  if (show === "matched") {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${txMatch} WHERE ${txMatch.transactionId} = ${transaction.id})`,
    );
  } else if (show === "unmatched") {
    filters.push(
      sql`NOT EXISTS (SELECT 1 FROM ${txMatch} WHERE ${txMatch.transactionId} = ${transaction.id})`,
    );
  }

  const rows = await db
    .select({
      id: transaction.id,
      counterparty: transaction.counterparty,
      description: transaction.description,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      matchedName: budgetItem.name,
      owner: bankAccount.owner,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
    .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(and(...filters))
    .orderBy(desc(transaction.bookingDate))
    .limit(PAGE_SIZE);

  // Pre-load this payday-month's items for the per-row reassign popover.
  const range = paydayMonthFor(new Date(), settings.paydayDay);
  const [monthRow] = await db
    .select()
    .from(month)
    .where(
      and(
        eq(month.anchorYear, range.anchorYear),
        eq(month.anchorMonth, range.anchorMonth),
      ),
    );
  const items = monthRow
    ? await db
        .select({
          id: budgetItem.id,
          name: budgetItem.name,
          section: budgetItem.section,
          scope: budgetItem.scope,
        })
        .from(budgetItem)
        .where(eq(budgetItem.monthId, monthRow.id))
        .orderBy(asc(budgetItem.section), asc(budgetItem.name))
    : [];
  const optionsAll: BudgetItemOption[] = items
    .filter((i) => allowed.includes(i.scope as "joint" | "camila" | "yann"))
    .map((i) => ({
      id: i.id,
      name: i.name,
      section: i.section as Section,
      scope: i.scope as "joint" | "camila" | "yann",
    }));
  const sectionLabels = SECTION_ORDER.reduce(
    (acc, s) => {
      acc[s] = tSections(SECTION_TR_KEY[s] as never);
      return acc;
    },
    {} as Record<Section, string>,
  );

  // Group by date for a calmer scroll.
  const groups: { date: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const key = formatGroupDate(r.bookingDate, locale);
    const last = groups[groups.length - 1];
    if (last && last.date === key) {
      last.rows.push(r);
    } else {
      groups.push({ date: key, rows: [r] });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
      </header>

      <form className="flex flex-col gap-3">
        <Input
          name="q"
          defaultValue={filterText}
          placeholder={t("searchPlaceholder")}
          className="num"
        />
        <div className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs">
          <FilterPill href={makeHref(filterText, "all")} active={show === "all"}>
            {t("filterAll")}
          </FilterPill>
          <FilterPill
            href={makeHref(filterText, "matched")}
            active={show === "matched"}
          >
            {t("filterMatched")}
          </FilterPill>
          <FilterPill
            href={makeHref(filterText, "unmatched")}
            active={show === "unmatched"}
          >
            {t("filterUnmatched")}
          </FilterPill>
        </div>
      </form>

      {rows.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.date} className="flex flex-col gap-1">
            <p className="px-1 pt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {g.date}
            </p>
            <Card className="border-border/40 bg-card/60 p-1">
              <ul className="divide-y divide-border/40">
                {g.rows.map((r) => {
                  const optsForScope = optionsAll.filter(
                    (o) => o.scope === r.owner,
                  );
                  return (
                    <li key={r.id} className="px-2">
                      <ActivityRow
                        tx={{
                          id: r.id,
                          counterparty: r.counterparty,
                          description: r.description,
                          bookingDate: r.bookingDate.toISOString(),
                          amountCents: r.amountCents,
                          matchedName: r.matchedName ?? null,
                          owner: r.owner as "joint" | "camila" | "yann",
                        }}
                        options={optsForScope}
                        locale={locale}
                        sectionLabels={sectionLabels}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))
      )}

      {rows.length === PAGE_SIZE ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("limited", { n: PAGE_SIZE })}
        </p>
      ) : null}
    </main>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const cls = active
    ? "bg-primary text-primary-foreground"
    : "text-muted-foreground hover:text-foreground";
  return (
    <Link
      href={href as `/transactions${string}`}
      className={`flex-1 rounded-full px-3 py-1.5 text-center uppercase tracking-[0.14em] transition-colors ${cls}`}
    >
      {children}
    </Link>
  );
}

function makeHref(q: string, show: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (show && show !== "all") params.set("show", show);
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

function formatGroupDate(d: Date, locale: string): string {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}
