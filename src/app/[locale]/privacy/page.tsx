import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing.ts";

export const metadata = {
  title: "Marcio — Privacy Policy",
};

/**
 * Privacy policy for Marcio. Required by Enable Banking when registering an
 * AISP application. Public route (whitelisted in proxy.ts) so partners can
 * read it without authenticating.
 *
 * Kept English-only on purpose: regulators and partners (FIN-FSA, Enable
 * Banking compliance) read English; the in-app UI is what's localized.
 */
export default async function PrivacyPage({
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
          Privacy Policy
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: 2026-05-07
        </p>
      </header>

      <section className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/90">
        <p>
          Marcio is a private household budgeting tool used by a closed
          two-person household. Access is restricted to a hard-coded
          allow-list of two Google accounts; there is no public sign-up. This
          policy describes how Marcio handles the personal and financial data
          it processes.
        </p>

        <h2 className="mt-4 text-base font-semibold">Who operates this app</h2>
        <p>
          Marcio is operated for personal use by Yann Braga
          (<a className="underline" href="mailto:yannbf@gmail.com">yannbf@gmail.com</a>).
          There is no commercial offering, no advertising, and no third-party
          analytics.
        </p>

        <h2 className="mt-4 text-base font-semibold">Data we hold</h2>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Account profile</strong>: email address, display name,
            role, and authentication metadata (sign-in timestamps, session
            tokens) for the two allow-listed users.
          </li>
          <li>
            <strong>Bank transactions</strong> imported from ING Netherlands
            either via manual CSV upload or via Enable Banking under PSD2.
            Each row contains: booking date, value date, amount, currency,
            counterparty name, free-text description, and the IBAN of the
            source account.
          </li>
          <li>
            <strong>Budget items</strong> synced from a private Google Sheet
            owned by the household.
          </li>
          <li>
            <strong>Categorization rules</strong> the user creates while
            assigning transactions to budget items.
          </li>
        </ul>

        <h2 className="mt-4 text-base font-semibold">
          Where the data lives
        </h2>
        <ul className="ml-4 list-disc space-y-1">
          <li>Application database: Neon Postgres (EU region).</li>
          <li>Hosting: Vercel.</li>
          <li>Authentication: Better Auth, with Google as the OAuth provider.</li>
          <li>
            No data is shared with third parties for analytics, advertising,
            profiling, or any other purpose. There is no tracking pixel and
            no third-party JavaScript on the application pages.
          </li>
        </ul>

        <h2 className="mt-4 text-base font-semibold">
          Bank data processing (PSD2)
        </h2>
        <p>
          For users who choose to connect their ING account via Enable
          Banking, transactions are retrieved through the PSD2 Account
          Information Service. Enable Banking Oy (Espoo, Finland; licensed
          AISP regulated by the Finnish Financial Supervisory Authority,
          FIN-FSA) acts as the technical service provider that forwards
          transaction data from the bank to Marcio. Per Enable Banking's own
          policy, they do not store, cache, or process transaction data
          beyond delivering it to the application authorised by the user.
        </p>
        <p>
          Consent is granted directly by the user to ING during the connect
          flow and lasts up to 180 days. The user can revoke it at any time
          from within the ING app or by clicking <em>Disconnect</em> on
          Marcio's <code>/settings/banks</code> page; revocation also asks
          Enable Banking to delete the corresponding session.
        </p>
        <p>
          CSV upload is supported as an alternative path; CSVs are parsed
          server-side and discarded — only the resulting transaction rows are
          retained.
        </p>

        <h2 className="mt-4 text-base font-semibold">Retention</h2>
        <p>
          Transaction history is retained for the lifetime of the household
          budget so trend analysis remains accurate. Either user can request
          full deletion of their personal data at any time by emailing
          {" "}
          <a className="underline" href="mailto:yannbf@gmail.com">
            yannbf@gmail.com
          </a>
          ; deletion is performed within 30 days.
        </p>

        <h2 className="mt-4 text-base font-semibold">Your rights (GDPR)</h2>
        <ul className="ml-4 list-disc space-y-1">
          <li>Right of access: request a copy of all data Marcio holds about you.</li>
          <li>Right to rectification: ask for incorrect data to be corrected.</li>
          <li>Right to erasure: ask for your data to be deleted.</li>
          <li>
            Right to withdraw bank consent: revoke the PSD2 consent at any
            time, either through ING's app or the in-app Disconnect action.
          </li>
        </ul>
        <p>
          Contact <a className="underline" href="mailto:yannbf@gmail.com">yannbf@gmail.com</a>
          {" "}for any of the above.
        </p>

        <h2 className="mt-4 text-base font-semibold">Security</h2>
        <p>
          Authentication tokens and bank session identifiers are encrypted at
          rest with AES-256-GCM. The encryption key is held only in Vercel's
          environment-variable store. All traffic is served over HTTPS.
        </p>

        <h2 className="mt-4 text-base font-semibold">Changes</h2>
        <p>
          Material changes to this policy will be communicated to the two
          household users by email and reflected in the &quot;Last
          updated&quot; date above.
        </p>
      </section>
    </main>
  );
}
