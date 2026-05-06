import { setRequestLocale } from "next-intl/server";
import { InboxScreen } from "@/components/marcio/inbox-screen.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InboxScreen locale={locale} />;
}
