"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client.ts";

type Owner = "joint" | "yann" | "camila";

/**
 * Three-pill segmented control for bank_account.owner.
 *
 * Sits on the per-account page so the user can re-tag a synced account
 * after Enable Banking returned it under a single login (e.g. flip the
 * joint checking from "yann" to "joint" so both household members see it).
 *
 * Privacy is enforced server-side in `settings.connections.setAccountOwner`.
 */
export function AccountOwnerToggle({
  bankAccountId,
  initialOwner,
}: {
  bankAccountId: string;
  initialOwner: Owner;
}) {
  const t = useTranslations("Account");
  const router = useRouter();
  const [owner, setOwner] = useState<Owner>(initialOwner);
  const [pending, startTransition] = useTransition();
  const utils = trpc.useUtils();

  const setAccountOwner =
    trpc.settings.connections.setAccountOwner.useMutation({
      onSuccess: (_, vars) => {
        setOwner(vars.owner);
        // Refresh server-rendered transaction list + connection panel.
        startTransition(() => router.refresh());
        void utils.settings.connections.list.invalidate();
      },
    });

  const options: { value: Owner; label: string }[] = [
    { value: "joint", label: t("ownerJoint") },
    { value: "yann", label: t("ownerYann") },
    { value: "camila", label: t("ownerCamila") },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t("ownershipLabel")}
      </p>
      <div className="inline-flex gap-1 rounded-md border border-border/40 bg-card/60 p-1">
        {options.map((opt) => {
          const active = owner === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={
                setAccountOwner.isPending || pending || active
              }
              onClick={() =>
                setAccountOwner.mutate({
                  bankAccountId,
                  owner: opt.value,
                })
              }
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              } disabled:cursor-not-allowed`}
            >
              {setAccountOwner.isPending &&
              setAccountOwner.variables?.owner === opt.value ? (
                <Loader2 className="mx-auto size-3.5 animate-spin" />
              ) : (
                opt.label
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("ownershipHint")}
      </p>
    </div>
  );
}
