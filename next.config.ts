import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    // Enable React's <ViewTransition> hooks so the locale layout can wrap
    // the page tree and get free cross-fades on every nav.
    viewTransition: true,
  },
};

export default withNextIntl(nextConfig);
