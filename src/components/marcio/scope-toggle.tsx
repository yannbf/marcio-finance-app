"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation.ts";

export type Scope = "joint" | "me";

const COOKIE = "marcio-month-scope";

function setScopeCookie(scope: Scope) {
  document.cookie = `${COOKIE}=${scope}; max-age=31536000; path=/; samesite=lax`;
}

export function ScopeToggle({
  activeScope,
  hasMe,
  jointLabel,
  meLabel,
}: {
  activeScope: "joint" | "me";
  hasMe: boolean;
  jointLabel: string;
  meLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(next: Scope) {
    if (next === activeScope) return;
    setScopeCookie(next);
    startTransition(() => {
      router.replace(`/month?scope=${next}`);
      router.refresh();
    });
  }

  return (
    <div
      className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs"
      data-pending={pending ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => pick("joint")}
        className={pillClass(activeScope === "joint")}
        aria-current={activeScope === "joint" ? "true" : undefined}
      >
        {jointLabel}
      </button>
      {hasMe ? (
        <button
          type="button"
          onClick={() => pick("me")}
          className={pillClass(activeScope === "me")}
          aria-current={activeScope === "me" ? "true" : undefined}
        >
          {meLabel}
        </button>
      ) : null}
    </div>
  );
}

function pillClass(active: boolean): string {
  return [
    "px-3 py-1.5 rounded-full uppercase tracking-[0.14em] transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}
