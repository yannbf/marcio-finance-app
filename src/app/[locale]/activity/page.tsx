import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ActivityScreen } from "@/components/marcio/activity-screen.tsx";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function ActivityPage({
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
      <ActivityScreen
        locale={locale}
        defaultAnchor={{ year: range.anchorYear, month: range.anchorMonth }}
      />
    </Suspense>
  );
}
