"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth/client.ts";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";

type Labels = {
  google: string;
  signingIn: string;
  errorGeneric: string;
};

export function SignInForm({
  labels,
  callbackPath,
}: {
  labels: Labels;
  callbackPath: string;
}) {
  const [state, setState] = useState<"idle" | "redirecting" | "error">("idle");

  async function googleSignIn() {
    setState("redirecting");
    try {
      await signIn.social({
        provider: "google",
        callbackURL: callbackPath,
      });
      // signIn.social triggers a full-page redirect; this only resolves
      // when the browser stays on the page (e.g. popup blocked).
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={googleSignIn}
        disabled={state === "redirecting"}
        className="h-11 gap-2 text-base"
        data-testid="sign-in-google"
      >
        <GoogleIcon className="size-4" />
        {state === "redirecting" ? labels.signingIn : labels.google}
      </Button>
      {state === "error" ? (
        <Card className="border-destructive/40 bg-destructive/10 p-3 text-center">
          <p className="text-xs text-destructive">{labels.errorGeneric}</p>
        </Card>
      ) : null}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.7 19 13 24 13c3 0 5.8 1.1 8 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5.2 0 9.9-2 13.5-5.2L31.2 33c-2 1.5-4.5 2.5-7.2 2.5-5.2 0-9.6-3.3-11.3-8L6.2 32.4C9.6 38.4 16.3 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.3 5.3C40 35 43.5 30 43.5 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
