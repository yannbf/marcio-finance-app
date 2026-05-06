import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { Card } from "@/components/ui/card.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function SignInVerifyPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await getCurrentUser();
  if (me) redirect({ href: "/", locale });
  const t = await getTranslations("SignIn");

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Card className="border-border/40 bg-card/60 p-6 text-center">
        <p className="text-base font-semibold">{t("verifyError")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("verifyBody")}
        </p>
        <Link
          href="/sign-in"
          className="mt-4 inline-block text-sm text-primary underline-offset-2 hover:underline"
        >
          {t("tryAgain")}
        </Link>
      </Card>
    </main>
  );
}
