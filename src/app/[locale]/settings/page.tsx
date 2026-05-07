import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { Banknote, PiggyBank, Inbox, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { db } from "@/db/index.ts";
import { bankAccount, month, transaction, txMatch } from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { PaydayInline } from "@/components/marcio/payday-inline.tsx";
import { LanguageSwitch } from "@/components/marcio/language-switch.tsx";
import { ThemeToggle } from "@/components/marcio/theme-toggle.tsx";
import { SignOutButton } from "@/components/marcio/sign-out-button.tsx";
import { AFRONDING_PG_PATTERN } from "@/lib/matching/seed-rules.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const tSignIn = await getTranslations("SignIn");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();
  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  // Inbox count for the badge — same filter as the Inbox screen so the
  // numbers don't disagree (Afronding round-ups excluded).
  const [{ n }] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, allowed),
        notExists(
          db
            .select({ one: sql`1` })
            .from(txMatch)
            .where(eq(txMatch.transactionId, transaction.id)),
        ),
        sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
      ),
    );
  const inboxCount = Number.parseInt(n, 10);

  // Most-recent sheet import across any month — surfaced under the version
  // line so users can confirm the daily cron is still running.
  const [latestImport] = await db
    .select({ importedAt: month.importedAt })
    .from(month)
    .orderBy(desc(month.importedAt))
    .limit(1);
  const lastImport = latestImport?.importedAt ?? null;
  const lastImportLabel = lastImport
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(lastImport)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        {me ? (
          <p className="num mt-1 text-xs text-muted-foreground">{me.email}</p>
        ) : null}
      </header>

      {/* Heavy-weight sections that warrant their own pages. */}
      <Card className="border-border/40 bg-card/60 p-1">
        <ul className="divide-y divide-border/40">
          <li>
            <Link
              href="/settings/banks"
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card/40"
            >
              <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
                <Banknote className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t("sections.banks.title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sections.banks.hint")}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
          <li>
            <Link
              href="/settings/savings"
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card/40"
            >
              <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
                <PiggyBank className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t("sections.savings.title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sections.savings.hint")}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
          <li>
            <Link
              href="/inbox"
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card/40"
            >
              <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
                <Inbox className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t("sections.inbox.title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sections.inbox.hint")}
                </p>
              </div>
              {inboxCount > 0 ? (
                <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {inboxCount}
                </span>
              ) : null}
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        </ul>
      </Card>

      {/* Single-control preferences live inline — no extra navigation. */}
      <Card className="flex flex-col gap-4 border-border/40 bg-card/60 p-5">
        <PaydayInline initialDay={settings.paydayDay} />
        <div className="border-t border-border/40" />
        <LanguageSwitch current={locale} />
        <div className="border-t border-border/40" />
        <ThemeToggle />
      </Card>

      {me ? (
        <div className="flex justify-center">
          <SignOutButton label={tSignIn("signOut")} />
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-0.5">
        <p className="text-center text-xs text-muted-foreground">
          Marcio v0.1
        </p>
        {lastImportLabel ? (
          <p className="num text-center text-[11px] text-muted-foreground/70">
            {t("lastSync", { at: lastImportLabel })}
          </p>
        ) : null}
      </div>
    </main>
  );
}
