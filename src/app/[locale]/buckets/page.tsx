import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BucketsScreen } from "@/components/marcio/buckets-screen.tsx";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { readScopeCookie } from "@/lib/scope-cookie.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function BucketsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getHouseholdSettings();
  const range = paydayMonthFor(new Date(), settings.paydayDay);
  const defaultScope = await readScopeCookie();
  return (
    <Suspense>
      <BucketsScreen
        locale={locale}
        defaultAnchor={{ year: range.anchorYear, month: range.anchorMonth }}
        defaultScope={defaultScope}
      />
    </Suspense>
  );
}
