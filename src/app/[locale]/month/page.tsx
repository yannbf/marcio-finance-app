import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/index.ts";
import { budgetItem, month, transaction, txMatch } from "@/db/schema.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { monthlyContributionCents } from "@/lib/cadence.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Link } from "@/i18n/navigation.ts";
import { formatEUR } from "@/lib/format.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { ScopeToggle } from "@/components/marcio/scope-toggle.tsx";
import type { Locale } from "@/i18n/routing.ts";

type Scope = "joint" | "camila" | "yann";
const SCOPE_COOKIE = "marcio-month-scope";

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const me = await getCurrentUser();
  const sp = await searchParams;
  const cookieScope = (await cookies()).get(SCOPE_COOKIE)?.value;

  // URL > cookie > default. Default = "me" when signed in, else "joint".
  const requested = (
    sp.scope ?? cookieScope ?? (me ? "me" : "joint")
  ).toLowerCase();
  const activeScope: Scope =
    requested === "joint"
      ? "joint"
      : me?.role ?? "joint"; // "me" resolves to the signed-in user's scope
  const toggleScope: "joint" | "me" =
    activeScope === "joint" ? "joint" : "me";

  // Find or fall back: current payday-month → its DB row.
  const settings = await getHouseholdSettings();
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

  const rawItems = monthRow
    ? await db
        .select()
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthRow.id),
            eq(budgetItem.scope, activeScope),
          ),
        )
        .orderBy(asc(budgetItem.section), asc(budgetItem.name))
    : [];

  // Match counts per item this payday-month — drives the paid/unpaid badge.
  const matchCounts = rawItems.length
    ? await db
        .select({
          itemId: txMatch.budgetItemId,
          count: sql<string>`COUNT(*)`,
        })
        .from(txMatch)
        .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
        .where(
          and(
            inArray(
              txMatch.budgetItemId,
              rawItems.map((i) => i.id),
            ),
            gte(transaction.bookingDate, range.startsOn),
            lte(transaction.bookingDate, range.endsOn),
          ),
        )
        .groupBy(txMatch.budgetItemId)
    : [];

  const matchByItem = new Map<string, number>(
    matchCounts.map((r) => [r.itemId, Number.parseInt(r.count, 10)]),
  );

  // Apply monthly conversion to plannedCents (SAZONAIS yearly → monthly).
  const items: ItemRow[] = rawItems.map((it) => ({
    id: it.id,
    name: it.name,
    section: it.section as Section,
    plannedCents: monthlyContributionCents(
      it.plannedCents,
      it.section as Section,
    ),
    dueDay: it.dueDay,
    sazonalKind: it.sazonalKind as "O" | "L" | null,
    matchCount: matchByItem.get(it.id) ?? 0,
  }));

  const grouped = groupBySection(items);
  const totals = computeTotals(items);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {anchorLabel(range.anchorYear, range.anchorMonth, locale)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {t("Nav.month")}
          </h1>
        </div>
        <ScopeToggle
          activeScope={toggleScope}
          hasMe={!!me}
          jointLabel={t("Scope.joint")}
          meLabel={t("Scope.me")}
        />
      </header>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label={t("Month.income")}
          cents={totals.income}
          locale={locale}
        />
        <SummaryCard
          label={t("Month.outflow")}
          cents={totals.outflow}
          locale={locale}
        />
        <SummaryCard
          label={t("Month.margin")}
          cents={totals.margin}
          locale={locale}
          highlight={totals.margin < 0 ? "negative" : "neutral"}
        />
      </div>

      {!monthRow || items.length === 0 ? (
        <Card className="border-border/40 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          <p>{t("Month.noData")}</p>
          <Link
            href="/import"
            className="mt-3 inline-block text-primary underline-offset-2 hover:underline"
          >
            {t("Import.run")}
          </Link>
        </Card>
      ) : (
        SECTION_ORDER.map((section) => {
          const list = grouped[section];
          if (!list || list.length === 0) return null;
          return (
            <SectionCard
              key={section}
              section={section}
              items={list}
              locale={locale}
              label={t(`Sections.${SECTION_TR_KEY[section]}`)}
            />
          );
        })
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  cents,
  locale,
  highlight,
}: {
  label: string;
  cents: number;
  locale: string;
  highlight?: "negative" | "neutral";
}) {
  return (
    <Card className="border-border/40 bg-card/60 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`num mt-1 text-base font-semibold tracking-tight ${
          highlight === "negative" ? "text-destructive" : ""
        }`}
      >
        {formatEUR(cents / 100, locale)}
      </p>
    </Card>
  );
}

function SectionCard({
  section,
  items,
  locale,
  label,
}: {
  section: Section;
  items: ItemRow[];
  locale: string;
  label: string;
}) {
  const total = items.reduce((s, i) => s + i.plannedCents, 0);
  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </h2>
        <p className="num text-sm font-semibold">
          {formatEUR(total / 100, locale)}
        </p>
      </header>
      <ul className="mt-3 divide-y divide-border/40">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/month/${item.id}` as `/month/${string}`}
              className="-mx-2 flex items-center justify-between gap-3 rounded px-2 py-2 text-sm transition-colors hover:bg-card/40"
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full ${
                  item.matchCount > 0
                    ? "bg-primary/15 text-primary"
                    : "border border-dashed border-border/60"
                }`}
                aria-label={item.matchCount > 0 ? "paid" : "not paid"}
              >
                {item.matchCount > 0 ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : null}
              </span>
              <span className="flex flex-1 items-baseline gap-2 truncate">
                <span className="truncate">{item.name}</span>
                {item.dueDay ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {item.dueDay}
                  </Badge>
                ) : null}
                {section === "SAZONAIS" && item.sazonalKind ? (
                  <Badge
                    variant={item.sazonalKind === "O" ? "default" : "secondary"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {item.sazonalKind}
                  </Badge>
                ) : null}
              </span>
              <span className="num text-foreground">
                {formatEUR(item.plannedCents / 100, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

type ItemRow = {
  id: string;
  name: string;
  section: Section;
  plannedCents: number;
  dueDay: number | null;
  sazonalKind: "O" | "L" | null;
  matchCount: number;
};

function groupBySection(rows: ItemRow[]): Partial<Record<Section, ItemRow[]>> {
  const out: Partial<Record<Section, ItemRow[]>> = {};
  for (const row of rows) {
    (out[row.section] ??= []).push(row);
  }
  return out;
}

function computeTotals(rows: ItemRow[]) {
  let income = 0;
  let outflow = 0;
  for (const row of rows) {
    if (row.section === "ECONOMIAS") continue;
    if (row.plannedCents > 0) income += row.plannedCents;
    else outflow += row.plannedCents;
  }
  return { income, outflow, margin: income + outflow };
}

function anchorLabel(year: number, month: number, locale: string): string {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/^\w/, (c) => c.toUpperCase());
}
