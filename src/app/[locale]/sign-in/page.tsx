import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { SignInForm } from "@/components/marcio/sign-in-form.tsx";
import type { Locale } from "@/i18n/routing.ts";

export default async function SignInPage({
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
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subheading")}</p>
      </header>
      <SignInForm
        labels={{
          emailLabel: t("emailLabel"),
          emailPlaceholder: t("emailPlaceholder"),
          submit: t("submit"),
          sending: t("sending"),
          linkSent: t("linkSent"),
          linkSentHint: t("linkSentHint"),
          errorGeneric: t("errorGeneric"),
        }}
        callbackPath={`/${locale}/sign-in/verify`}
      />
    </main>
  );
}
