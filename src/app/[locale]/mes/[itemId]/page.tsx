import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  bankAccount,
  matchSource,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { TransactionRow } from "@/components/marcio/transaction-row.tsx";
import { Link } from "@/i18n/navigation.ts";
import { formatEUR } from "@/lib/format.ts";
import { monthlyContributionCents } from "@/lib/cadence.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function BudgetItemDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; itemId: string }>;
}) {
  const { locale, itemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ItemDetail");
  const tSections = await getTranslations("Sections");
  const me = await getCurrentUser();

  const [item] = await db
    .select()
    .from(budgetItem)
    .where(eq(budgetItem.id, itemId));
  if (!item) notFound();

  // Privacy guard: personal items are only visible to their owner.
  if (item.scope !== "joint") {
    if (!me || item.scope !== me.role) notFound();
  }

  // All matched transactions for this item.
  const rows = await db
    .select({
      id: transaction.id,
      counterparty: transaction.counterparty,
      description: transaction.description,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      allocatedCents: txMatch.allocatedCents,
      source: txMatch.source,
      accountNickname: bankAccount.nickname,
    })
    .from(txMatch)
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(eq(txMatch.budgetItemId, item.id))
    .orderBy(asc(transaction.bookingDate));

  const actualCents = rows.reduce((s, r) => s + r.allocatedCents, 0);
  const plannedMonthly = monthlyContributionCents(
    item.plannedCents,
    item.section as Section,
  );
  const isOutflow = item.plannedCents < 0;
  const absActual = Math.abs(actualCents);
  const absPlanned = Math.abs(plannedMonthly);
  const isSazonal = item.section === "SAZONAIS";
  const ratio = absPlanned > 0 ? Math.min(1, absActual / absPlanned) : 0;
  const remaining = absPlanned - absActual;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex items-start gap-3">
        <Link
          href="/mes"
          className="-m-2 mt-0 rounded p-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("back")}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {tSections(
              SECTION_TR_KEY[item.section as Section] as never,
            )}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
            {item.name}
          </h1>
          {item.dueDay ? (
            <p className="num mt-1 text-xs text-muted-foreground">
              {t("dueDay", { day: item.dueDay })}
            </p>
          ) : null}
        </div>
      </header>

      <Card className="border-border/40 bg-card/60 p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {isOutflow ? t("spent") : t("received")}
        </p>
        <p className="num mt-1 text-3xl font-semibold tracking-tight">
          {formatEUR(absActual / 100, locale)}
        </p>
        <p className="num mt-1 text-sm text-muted-foreground">
          {t("ofPlanned", { planned: formatEUR(absPlanned / 100, locale) })}
        </p>
        {isSazonal ? (
          <p className="num mt-1 text-[11px] text-muted-foreground">
            {t("yearlyHint", {
              yearly: formatEUR(Math.abs(item.plannedCents) / 100, locale),
            })}
          </p>
        ) : null}

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${
              ratio > 1.05 ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground num">
          <span>{Math.round(ratio * 100)}%</span>
          <span>
            {t("remaining")}:{" "}
            {formatEUR(Math.max(0, remaining) / 100, locale)}
          </span>
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("matchedTitle", { n: rows.length })}
        </p>
        {rows.length === 0 ? (
          <Card className="border-border/40 bg-card/40 p-5 text-center text-sm text-muted-foreground">
            {t("none")}
          </Card>
        ) : (
          <Card className="border-border/40 bg-card/60 p-1">
            <ul className="divide-y divide-border/40">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center px-2">
                  <div className="flex-1">
                    <TransactionRow
                      counterparty={r.counterparty}
                      description={r.description}
                      bookingDate={r.bookingDate}
                      amountCents={r.amountCents}
                      locale={locale}
                      matchedLabel={r.accountNickname}
                    />
                  </div>
                  {r.source !== "user" ? (
                    <Badge
                      variant="secondary"
                      className="ml-2 mr-1 px-1.5 py-0 text-[10px]"
                    >
                      {sourceLabel(r.source, t)}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </main>
  );
}

function sourceLabel(
  src: typeof matchSource.enumValues[number],
  t: (k: "auto" | "learned") => string,
): string {
  if (src === "auto-rule") return t("auto");
  if (src === "learned") return t("learned");
  return src;
}
