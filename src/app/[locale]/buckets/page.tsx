import { setRequestLocale } from "next-intl/server";
import { BucketsScreen } from "@/components/marcio/buckets-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function BucketsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BucketsScreen locale={locale} />;
}
