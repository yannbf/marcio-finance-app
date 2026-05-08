import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BucketsScreen } from "@/components/marcio/buckets-screen.tsx";
import { getPageDefaults } from "@/lib/page-defaults.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function BucketsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { defaultAnchor, defaultScope, defaultMeRole } = await getPageDefaults();
  return (
    <Suspense>
      <BucketsScreen
        locale={locale}
        defaultAnchor={defaultAnchor}
        defaultScope={defaultScope}
        defaultMeRole={defaultMeRole}
      />
    </Suspense>
  );
}
