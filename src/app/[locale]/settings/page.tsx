import { setRequestLocale, getTranslations } from "next-intl/server";
import { Banknote, PiggyBank, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { PaydayInline } from "@/components/marcio/payday-inline.tsx";
import { LanguageSwitch } from "@/components/marcio/language-switch.tsx";
import { ThemeIndicator } from "@/components/marcio/theme-indicator.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

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
        </ul>
      </Card>

      {/* Single-control preferences live inline — no extra navigation. */}
      <Card className="flex flex-col gap-4 border-border/40 bg-card/60 p-5">
        <PaydayInline initialDay={settings.paydayDay} />
        <div className="border-t border-border/40" />
        <LanguageSwitch current={locale} />
        <div className="border-t border-border/40" />
        <ThemeIndicator />
      </Card>

      <p className="text-center text-xs text-muted-foreground">Marcio v0.1</p>
    </main>
  );
}
