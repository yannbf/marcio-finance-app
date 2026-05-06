import { setRequestLocale } from "next-intl/server";
import { InsightsScreen } from "@/components/marcio/insights-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InsightsScreen locale={locale} />;
}
