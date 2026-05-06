import { setRequestLocale, getTranslations, getLocale } from "next-intl/server";
import { desc, count, eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { CsvUpload } from "@/components/marcio/csv-upload.tsx";
import { PaydaySetting } from "@/components/marcio/payday-setting.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Connections");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const accounts = await db
    .select({
      id: bankAccount.id,
      owner: bankAccount.owner,
      nickname: bankAccount.nickname,
      iban: bankAccount.iban,
      lastSyncedAt: bankAccount.lastSyncedAt,
      txCount: count(transaction.id),
    })
    .from(bankAccount)
    .leftJoin(transaction, eq(transaction.bankAccountId, bankAccount.id))
    .groupBy(bankAccount.id)
    .orderBy(desc(bankAccount.lastSyncedAt));

  // Choices the current user is allowed to upload on behalf of.
  const ownerOptions: { value: "joint" | "camila" | "yann"; label: string }[] =
    me
      ? [
          { value: "joint", label: t("ownerJoint") },
          {
            value: me.role,
            label: me.role === "yann" ? t("ownerYann") : t("ownerCamila"),
          },
        ]
      : [{ value: "joint", label: t("ownerJoint") }];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
      </header>

      <PaydaySetting initialDay={settings.paydayDay} />

      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("uploadTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("uploadHint")}
        </p>
        <div className="mt-4">
          <CsvUpload
            ownerOptions={ownerOptions}
            defaultOwner={me?.role ?? "joint"}
          />
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("accountsTitle")}
          </h2>
          <Link
            href="/transactions"
            className="text-xs text-primary hover:underline"
          >
            {t("seeAllTransactions")}
          </Link>
        </div>
        {accounts.length === 0 ? (
          <Card className="border-border/40 bg-card/40 p-5 text-sm text-muted-foreground">
            {t("noAccounts")}
          </Card>
        ) : (
          accounts.map((a) => (
            <Link
              key={a.id}
              href={`/connections/${a.id}` as `/connections/${string}`}
            >
              <Card className="flex flex-row items-center gap-3 border-border/40 bg-card/60 px-4 py-3 transition-colors hover:bg-card/80">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.nickname}</p>
                  <p className="num truncate text-xs text-muted-foreground">
                    {ownerLabel(a.owner, t)} · {a.iban || "—"}
                  </p>
                </div>
                <div className="text-right leading-none">
                  <p className="num text-sm font-semibold">{a.txCount}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t("txCount")}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Card>
            </Link>
          ))
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        {t("footnote")}
      </p>
    </main>
  );
}

function ownerLabel(
  owner: string,
  t: (k: "ownerJoint" | "ownerCamila" | "ownerYann") => string,
): string {
  if (owner === "joint") return t("ownerJoint");
  if (owner === "yann") return t("ownerYann");
  if (owner === "camila") return t("ownerCamila");
  return owner;
}
