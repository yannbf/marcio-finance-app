import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  Banknote,
  PiggyBank,
  Calendar,
  Languages,
  Moon,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import type { Locale } from "@/i18n/routing.ts";

const SECTIONS = [
  { href: "/settings/banks", icon: Banknote, key: "banks" },
  { href: "/settings/savings", icon: PiggyBank, key: "savings" },
  { href: "/settings/month", icon: Calendar, key: "month" },
  { href: "/settings/language", icon: Languages, key: "language" },
  { href: "/settings/theme", icon: Moon, key: "theme" },
] as const;

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const me = await getCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        {me ? (
          <p className="num mt-1 text-xs text-muted-foreground">
            {me.email}
          </p>
        ) : null}
      </header>

      <Card className="border-border/40 bg-card/60 p-1">
        <ul className="divide-y divide-border/40">
          {SECTIONS.map(({ href, icon: Icon, key }) => (
            <li key={key}>
              <Link
                href={href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card/40"
              >
                <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`sections.${key}.title` as never)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`sections.${key}.hint` as never)}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Marcio v0.1
      </p>
    </main>
  );
}
