import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { TransactionsScreen } from "@/components/marcio/transactions-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <TransactionsScreen locale={locale} />
    </Suspense>
  );
}
