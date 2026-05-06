import { setRequestLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, Moon } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function ThemeSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings.sections.theme");

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

      <Card className="flex items-center gap-3 border-border/40 bg-card/60 p-5">
        <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
          <Moon className="size-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{t("darkLocked")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("hint")}
          </p>
        </div>
      </Card>
    </main>
  );
}
