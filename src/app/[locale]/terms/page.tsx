import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing.ts";

export const metadata = {
  title: "Marcio — Terms of Use",
};

/**
 * Terms of use for Marcio. Optional but useful to have on file for the
 * Enable Banking application form. Public route (whitelisted in proxy.ts).
 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pb-16 pt-10">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Marcio
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Terms of Use
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: 2026-05-07
        </p>
      </header>

      <section className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/90">
        <p>
          Marcio is a private personal-finance tool. Access is restricted by
          a hard-coded allow-list to two named users — there is no public
          sign-up. By signing in, you agree to the following:
        </p>

        <h2 className="mt-4 text-base font-semibold">Use</h2>
        <ul className="ml-4 list-disc space-y-1">
          <li>The service is provided as-is, without warranty of any kind.</li>
          <li>
            Marcio is not a regulated financial advisor and does not provide
            investment, tax, or accounting advice. Numbers shown should be
            treated as a personal record-keeping aid only.
          </li>
          <li>
            You are responsible for the accuracy of categorizations,
            connected accounts, and any consents you grant to third parties
            (e.g. ING, Enable Banking) on Marcio's behalf.
          </li>
        </ul>

        <h2 className="mt-4 text-base font-semibold">
          Bank connections (PSD2)
        </h2>
        <p>
          When you choose to connect your bank account through Enable
          Banking, the consent is granted by you directly to your bank
          during the connect flow. You can revoke that consent at any time
          from within the ING app or by clicking Disconnect inside Marcio.
          Revoking consent stops future syncs but does not delete previously
          imported transactions; deletion can be requested via email.
        </p>

        <h2 className="mt-4 text-base font-semibold">Data</h2>
        <p>
          Handling of personal and financial data is described in the{" "}
          <a className="underline" href="/privacy">Privacy Policy</a>. The
          service does not sell, rent, or share user data with any third
          party.
        </p>

        <h2 className="mt-4 text-base font-semibold">Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, the operator of
          Marcio is not liable for any indirect, incidental, or consequential
          damages arising from the use of the service.
        </p>

        <h2 className="mt-4 text-base font-semibold">Contact</h2>
        <p>
          <a className="underline" href="mailto:yannbf@gmail.com">
            yannbf@gmail.com
          </a>
        </p>
      </section>
    </main>
  );
}
