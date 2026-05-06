import { setRequestLocale } from "next-intl/server";
import { TikkieScreen } from "@/components/marcio/tikkie-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function TikkiePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TikkieScreen locale={locale} />;
}
