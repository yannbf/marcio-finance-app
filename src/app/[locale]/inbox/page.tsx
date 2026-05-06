import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, desc, eq, sql, notExists } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { Card } from "@/components/ui/card.tsx";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import { InboxRow, type BudgetItemOption } from "@/components/marcio/inbox-row.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Inbox");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const allowedScopes: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  // Unmatched transactions on accounts the current user can see, newest first.
  const rows = await db
    .select({
      id: transaction.id,
      counterparty: transaction.counterparty,
      description: transaction.description,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      owner: bankAccount.owner,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        notExists(
          db
            .select({ one: sql`1` })
            .from(txMatch)
            .where(eq(txMatch.transactionId, transaction.id)),
        ),
        sql`${bankAccount.owner} = ANY (${sql.raw(`ARRAY['${allowedScopes.join("','")}']::account_owner[]`)})`,
      ),
    )
    .orderBy(desc(transaction.bookingDate));

  // Filter out ING round-up sweeps so they don't drown the inbox.
  const visible = rows.filter((r) => !isAfronding(r));

  // Pre-load budget items for the current payday-month, scoped to what the
  // user can see. The bottom-sheet picker uses these as targets.
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
    .filter((i) => allowedScopes.includes(i.scope as "joint" | "camila" | "yann"))
    .map((i) => ({
      id: i.id,
      name: i.name,
      section: i.section,
      scope: i.scope as "joint" | "camila" | "yann",
    }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <span className="num text-sm text-muted-foreground">
            {t("count", { n: visible.length })}
          </span>
        </div>
      </header>

      {visible.length === 0 ? (
        <Card className="border-border/40 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs">{t("emptyHint")}</p>
        </Card>
      ) : (
        <Card className="border-border/40 bg-card/60 p-2">
          <ul className="divide-y divide-border/40">
            {visible.map((tx) => {
              const optsForScope = optionsAll.filter(
                (o) => o.scope === tx.owner,
              );
              return (
                <li key={tx.id} className="px-2">
                  <InboxRow
                    tx={{
                      id: tx.id,
                      counterparty: tx.counterparty,
                      description: tx.description,
                      bookingDate: tx.bookingDate.toISOString(),
                      amountCents: tx.amountCents,
                    }}
                    options={optsForScope}
                    locale={locale}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </main>
  );
}

function isAfronding(row: {
  counterparty: string | null;
  description: string | null;
}): boolean {
  const text = `${row.counterparty ?? ""} ${row.description ?? ""}`;
  return AFRONDING_PATTERN.test(text);
}
