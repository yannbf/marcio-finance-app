import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { MonthScreen } from "@/components/marcio/month-screen.tsx";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function MonthPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Compute the current payday-month server-side so the client doesn't
  // need to know about paydayDay; the URL anchor still wins when set.
  const settings = await getHouseholdSettings();
  const range = paydayMonthFor(new Date(), settings.paydayDay);

  return (
    <Suspense>
      <MonthScreen
        locale={locale}
        defaultAnchor={{ year: range.anchorYear, month: range.anchorMonth }}
      />
    </Suspense>
  );
}
