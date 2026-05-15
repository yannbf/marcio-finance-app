import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing.ts";
import { BottomNav } from "@/components/marcio/bottom-nav.tsx";
import { IosInstallHint } from "@/components/marcio/ios-install-hint.tsx";
import { ThemeApplier } from "@/components/marcio/theme-applier.tsx";
import { UpdatePrompt } from "@/components/marcio/update-prompt.tsx";
import { TrpcProvider } from "@/lib/trpc/provider.tsx";
import "../globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marcio",
  description: "Where you are this month.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Marcio",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();
  // Captured at render time. The client component compares it against
  // /api/version on focus/interval to detect a deploy.
  const buildVersion = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint theme bootstrap. External script avoids the
            "<script> in JSX" hydration warning, runs synchronously,
            and ThemeApplier keeps the class in sync after navigation. */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-dvh bg-background text-foreground">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <TrpcProvider>
            <ThemeApplier />
            <div
              className="min-h-dvh"
              style={{
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom:
                  "calc(5rem + env(safe-area-inset-bottom))",
                viewTransitionName: "page",
              }}
            >
              {children}
            </div>
            {/* Solid backdrop behind the iOS status bar so scrolled content
                doesn't bleed under the time/wifi/battery indicators with the
                "black-translucent" status bar style. Lives above the page
                z-stack but below the install hint and modals. */}
            <div
              aria-hidden
              className="pointer-events-none fixed inset-x-0 top-0 z-40 bg-background"
              style={{ height: "env(safe-area-inset-top)" }}
            />
            {/* BottomNav reads useSearchParams() to thread `?scope=…`
                into its link hrefs. Next 16 demands a Suspense
                boundary around any client component that does that —
                without it, statically prerendered pages (the import
                page, terms, privacy, etc.) bail out at build time. */}
            <Suspense fallback={null}>
              <BottomNav />
            </Suspense>
            <IosInstallHint />
            <UpdatePrompt buildVersion={buildVersion} />
          </TrpcProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
