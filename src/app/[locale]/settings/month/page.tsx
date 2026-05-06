import { setRequestLocale, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { PaydaySetting } from "@/components/marcio/payday-setting.tsx";
import { getHouseholdSettings } from "@/lib/settings.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function MonthSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings.sections.month");
  const settings = await getHouseholdSettings();

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

      <PaydaySetting initialDay={settings.paydayDay} />

      <Card className="border-border/40 bg-card/40 p-5 text-xs text-muted-foreground">
        {t("about")}
      </Card>
    </main>
  );
}
