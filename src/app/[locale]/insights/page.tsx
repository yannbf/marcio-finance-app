import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { InsightsScreen } from "@/components/marcio/insights-screen.tsx";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getHouseholdSettings();
  const range = paydayMonthFor(new Date(), settings.paydayDay);
  return (
    <Suspense>
      <InsightsScreen
        locale={locale}
        defaultAnchor={{ year: range.anchorYear, month: range.anchorMonth }}
      />
    </Suspense>
  );
}
