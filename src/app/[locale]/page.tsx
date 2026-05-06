import { setRequestLocale } from "next-intl/server";
import { TodayScreen } from "@/components/marcio/today-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <TodayScreen locale={locale} />;
}
