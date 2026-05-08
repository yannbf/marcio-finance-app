import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ActivityScreen } from "@/components/marcio/activity-screen.tsx";
import { getPageDefaults } from "@/lib/page-defaults.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { defaultAnchor, defaultScope, defaultMeRole } = await getPageDefaults();
  return (
    <Suspense>
      <ActivityScreen
        locale={locale}
        defaultAnchor={defaultAnchor}
        defaultScope={defaultScope}
        defaultMeRole={defaultMeRole}
      />
    </Suspense>
  );
}
