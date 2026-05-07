import { NextResponse } from "next/server";

/**
 * Returns the running build's git SHA.
 *
 * Used by `<UpdatePrompt />` on the client: it captures this value at first
 * paint and re-fetches periodically. When the response no longer matches the
 * captured value — i.e. a new deploy has shipped — the prompt surfaces a
 * "Refresh" banner. Public, no auth.
 *
 * Vercel injects `VERCEL_GIT_COMMIT_SHA` into every build automatically.
 * In local dev there's no SHA, so we return "dev" — the prompt is gated on
 * version !== "dev" so it never fires while you're on `pnpm dev`.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  return NextResponse.json(
    { version },
    {
      headers: {
        // Do not let any layer (CDN, browser HTTP cache, Service Worker) cache
        // this — the whole point is to tell the client the *current* build.
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}
