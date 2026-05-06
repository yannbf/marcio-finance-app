import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt-BR"],
  defaultLocale: "pt-BR",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
