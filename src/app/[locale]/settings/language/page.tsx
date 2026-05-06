import { setRequestLocale, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { routing, type Locale } from "@/i18n/routing.ts";

export default async function LanguageSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings.sections.language");

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

      <Card className="border-border/40 bg-card/60 p-1">
        <ul className="divide-y divide-border/40">
          {routing.locales.map((l) => (
            <li key={l}>
              <Link
                href="/settings/language"
                locale={l}
                className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-card/40"
              >
                <span className="font-medium">
                  {l === "pt-BR" ? "Português (Brasil)" : "English"}
                </span>
                {l === locale ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary-foreground">
                    {t("current")}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </main>
  );
}
