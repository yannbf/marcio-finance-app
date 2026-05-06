import { setRequestLocale } from "next-intl/server";
import { ActivityScreen } from "@/components/marcio/activity-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ActivityScreen locale={locale} />;
}
