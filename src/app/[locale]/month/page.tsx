import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { MonthScreen } from "@/components/marcio/month-screen.tsx";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import type { Locale } from "@/i18n/routing.ts";

const SCOPE_COOKIE = "marcio-month-scope";

export default async function MonthPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Resolve the initial scope on the server so the first paint isn't
  // forced into "joint" before the client cookie is read.
  const me = await getCurrentUser();
  const cookieScope = (await cookies()).get(SCOPE_COOKIE)?.value;
  const initialScope: "joint" | "yann" | "camila" =
    cookieScope === "joint" || !me
      ? "joint"
      : me.role;

  return (
    <Suspense>
      <MonthScreen locale={locale} initialScope={initialScope} />
    </Suspense>
  );
}
