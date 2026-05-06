"use client";

import { HelpCircle, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { useTranslations } from "next-intl";

/**
 * Click target that opens a popover with step-by-step instructions for
 * exporting a CSV from "Mijn ING" (web) or the ING NL mobile app.
 */
export function CsvHelp() {
  const t = useTranslations("Connections.csvHelp");

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-label={t("trigger")}
      >
        <HelpCircle className="size-3.5" />
        {t("trigger")}
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="start" sideOffset={8}>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("webHeading")}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed">
              <li>{t("step1")}</li>
              <li>{t("step2")}</li>
              <li>{t("step3")}</li>
              <li>{t("step4")}</li>
              <li>{t("step5")}</li>
            </ol>
            <a
              href="https://mijn.ing.nl/banking/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("webLink")}
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="border-t border-border/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("appHeading")}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed">
              <li>{t("appStep1")}</li>
              <li>{t("appStep2")}</li>
              <li>{t("appStep3")}</li>
            </ol>
          </div>

          <div className="rounded-md bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
            {t("tip")}
          </div>

          <a
            href="https://www.ing.nl/particulier/klantenservice/internetbankieren/transactiegeschiedenis"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("officialDocs")}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
