"use client";

import { useState, useTransition } from "react";
import { Loader2, Download } from "lucide-react";
import { runImport, type ImportActionResult } from "@/app/[locale]/import/actions.ts";
import { Button } from "@/components/ui/button.tsx";

export function ImportButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportActionResult | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          startTransition(async () => {
            const r = await runImport();
            setResult(r);
          })
        }
        disabled={pending}
        size="lg"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        {label}
      </Button>

      {result && !result.ok && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.error}
        </p>
      )}

      {result?.ok && (
        <div className="rounded-md border border-border/60 bg-card/50 px-4 py-3 text-sm">
          {result.results.map((r) => (
            <div key={r.anchor} className="flex flex-col gap-1">
              <p className="font-medium">{r.anchor}</p>
              <p className="text-muted-foreground num">
                {r.inserted} new · {r.updated} updated · {r.unchanged} unchanged
              </p>
              {r.warnings.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {r.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
