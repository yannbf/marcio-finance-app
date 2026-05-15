import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { TodayScreen } from "@/components/marcio/today-screen.tsx";
import { PullToRefresh } from "@/components/marcio/pull-to-refresh.tsx";
import { daysUntilNextPayday } from "@/lib/payday.ts";
import { getPageDefaults } from "@/lib/page-defaults.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { defaultAnchor, defaultScope, defaultMeRole, paydayDay } =
    await getPageDefaults();
  // Pre-compute days-until-payday on the server so the badge renders
  // identically on SSR and first client paint — eliminates the
  // hydration mismatch the async persister was causing when it restored
  // `data` between server render and client mount (server saw Skeleton,
  // client saw Badge).
  const defaultDaysUntilPayday = daysUntilNextPayday(new Date(), paydayDay);
  return (
    <Suspense>
      <PullToRefresh>
        <TodayScreen
          locale={locale}
          defaultAnchor={defaultAnchor}
          defaultScope={defaultScope}
          defaultMeRole={defaultMeRole}
          defaultDaysUntilPayday={defaultDaysUntilPayday}
        />
      </PullToRefresh>
    </Suspense>
  );
}
