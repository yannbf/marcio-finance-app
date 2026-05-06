import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db/index.ts";
import { budgetItem, month, savingsAccount } from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import {
  SavingsForm,
  type SavingsRow,
} from "@/components/marcio/savings-form.tsx";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function SavingsSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings.sections.savings");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  const rows = (await db
    .select()
    .from(savingsAccount)
    .where(inArray(savingsAccount.owner, allowed))
    .orderBy(asc(savingsAccount.owner), asc(savingsAccount.nickname))) as SavingsRow[];

  // Suggest SAZONAIS items from the current month so the user can link
  // a savings account to the line that draws from it.
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
  const suggestions = monthRow
    ? await db
        .select({
          naturalKey: budgetItem.naturalKey,
          name: budgetItem.name,
        })
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthRow.id),
            eq(budgetItem.section, "SAZONAIS"),
            inArray(budgetItem.scope, allowed),
          ),
        )
        .orderBy(asc(budgetItem.name))
    : [];

  const tConn = await getTranslations("Connections");
  const ownerOptions: { value: "joint" | "camila" | "yann"; label: string }[] =
    me
      ? [
          { value: "joint", label: tConn("ownerJoint") },
          {
            value: me.role,
            label:
              me.role === "yann"
                ? tConn("ownerYann")
                : tConn("ownerCamila"),
          },
        ]
      : [{ value: "joint", label: tConn("ownerJoint") }];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex items-center gap-3">
        <Link
          href="/settings"
          className="-m-2 rounded p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("crumb")}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
        </div>
      </header>

      <Card className="border-border/40 bg-card/40 p-4 text-xs text-muted-foreground">
        {t("about")}
      </Card>

      <SavingsForm
        rows={rows}
        ownerOptions={ownerOptions}
        defaultOwner={me?.role ?? "joint"}
        budgetItemSuggestions={suggestions}
      />
    </main>
  );
}
