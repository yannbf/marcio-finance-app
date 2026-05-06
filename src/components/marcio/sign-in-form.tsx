"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth/client.ts";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";

type Labels = {
  emailLabel: string;
  emailPlaceholder: string;
  submit: string;
  sending: string;
  linkSent: string;
  linkSentHint: string;
  errorGeneric: string;
};

export function SignInForm({
  labels,
  callbackPath,
}: {
  labels: Labels;
  callbackPath: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    try {
      await signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: callbackPath,
      });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <Card className="border-border/40 bg-card/60 p-6 text-center">
        <p className="text-base font-semibold">{labels.linkSent}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {labels.linkSentHint}
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {labels.emailLabel}
        </span>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          placeholder={labels.emailPlaceholder}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === "sending"}
          className="h-11 text-base"
        />
      </label>
      <Button
        type="submit"
        size="lg"
        disabled={state === "sending" || !email.trim()}
      >
        {state === "sending" ? labels.sending : labels.submit}
      </Button>
      {state === "error" ? (
        <p className="text-xs text-destructive">{labels.errorGeneric}</p>
      ) : null}
    </form>
  );
}
