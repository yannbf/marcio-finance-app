"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/client.ts";
import { Button } from "@/components/ui/button.tsx";

export function SignOutButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
        } finally {
          window.location.assign("/");
        }
      }}
    >
      <LogOut className="size-4" />
      {label}
    </Button>
  );
}
