import { setRequestLocale, getTranslations } from "next-intl/server";
import { ImportButton } from "@/components/marcio/import-button.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const localPath = process.env.MARCIO_LOCAL_XLSX;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("Import.title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("Import.heading")}
        </h1>
      </header>

      <section className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm">
        <p className="text-muted-foreground">{t("Import.sourceLabel")}</p>
        <p className="mt-1 font-mono text-xs">
          {localPath ?? sheetId ?? t("Import.sourceMissing")}
        </p>
      </section>

      <ImportButton label={t("Import.run")} />

      <p className="mt-6 text-xs text-muted-foreground">{t("Import.help")}</p>
    </main>
  );
}
