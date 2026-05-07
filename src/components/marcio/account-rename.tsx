"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { trpc } from "@/lib/trpc/client.ts";

/**
 * Inline rename for a bank_account.nickname.
 *
 * Renders the nickname as plain text with a pencil icon next to it; click
 * the pencil to swap into an inline input + save/cancel buttons. On save
 * we call settings.connections.renameAccount and refresh the page so the
 * new name is reflected everywhere it's read server-side.
 */
export function AccountRename({
  bankAccountId,
  initialNickname,
}: {
  bankAccountId: string;
  initialNickname: string;
}) {
  const t = useTranslations("Account");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNickname);
  const [pending, startTransition] = useTransition();

  const renameAccount =
    trpc.settings.connections.renameAccount.useMutation({
      onSuccess: () => {
        setEditing(false);
        startTransition(() => router.refresh());
      },
    });

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">
          {initialNickname}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraft(initialNickname);
            setEditing(true);
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          aria-label={t("renameAria")}
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const value = draft.trim();
        if (!value || value === initialNickname) {
          setEditing(false);
          return;
        }
        renameAccount.mutate({ bankAccountId, nickname: value });
      }}
    >
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        maxLength={80}
        className="h-9 text-base"
        aria-label={t("renameAria")}
      />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={renameAccount.isPending || pending}
        aria-label={t("renameSave")}
      >
        {renameAccount.isPending || pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setDraft(initialNickname);
          setEditing(false);
        }}
        aria-label={t("renameCancel")}
      >
        <X className="size-4" />
      </Button>
    </form>
  );
}
