import { setRequestLocale, getTranslations, getLocale } from "next-intl/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { TransactionRow } from "@/components/marcio/transaction-row.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; accountId: string }>;
}) {
  const { locale, accountId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");
  const me = await getCurrentUser();

  const [account] = await db
    .select()
    .from(bankAccount)
    .where(eq(bankAccount.id, accountId));
  if (!account) notFound();

  // Privacy guard: a personal account is only visible to its owner.
  if (account.owner !== "joint") {
    if (!me || account.owner !== me.role) notFound();
  }

  // Fetch the latest 200 transactions for the account, with their first
  // matched budget item label (if any) attached.
  const rows = await db
    .select({
      id: transaction.id,
      counterparty: transaction.counterparty,
      description: transaction.description,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      matchedName: budgetItem.name,
      matchedSection: budgetItem.section,
    })
    .from(transaction)
    .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
    .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(eq(transaction.bankAccountId, account.id))
    .orderBy(desc(transaction.bookingDate))
    .limit(200);

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
      <header className="flex items-center gap-3">
        <Link
          href="/connections"
          className="-m-2 rounded p-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("back")}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {ownerLabel(account.owner, t)}
          </p>
          <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">
            {account.nickname}
          </h1>
          <p className="num mt-1 truncate text-xs text-muted-foreground">
            {account.iban}
          </p>
        </div>
      </header>

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
                {g.rows.map((r) => (
                  <li key={r.id} className="px-2">
                    <TransactionRow
                      counterparty={r.counterparty}
                      description={r.description}
                      bookingDate={r.bookingDate}
                      amountCents={r.amountCents}
                      locale={locale}
                      matchedLabel={r.matchedName ?? null}
                      unmatched={!r.matchedName}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </main>
  );
}

function ownerLabel(
  owner: string,
  t: (k: "ownerJoint" | "ownerYann" | "ownerCamila") => string,
): string {
  if (owner === "joint") return t("ownerJoint");
  if (owner === "yann") return t("ownerYann");
  if (owner === "camila") return t("ownerCamila");
  return owner;
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
