import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankConnection } from "@/db/schema.ts";
import { encryptSecret } from "@/lib/crypto/secrets.ts";
import { createSession } from "@/lib/enable_banking/client.ts";
import { syncConnection } from "@/lib/enable_banking/sync.ts";

/**
 * GET /api/banks/callback?cid=<connectionId>&locale=<…>&code=<…>&state=<…>&error=<…>
 *
 * Enable Banking redirects the user back here after they've finished (or
 * cancelled) the consent flow at the bank. We:
 *   1. Look up the pending connection by `cid` (we put it in the redirect
 *      URL ourselves; `state` is the same value, returned by Enable Banking).
 *   2. POST /sessions with the `code` to receive a long-lived session_id +
 *      the list of accessible accounts.
 *   3. Persist the encrypted session_id, mark the connection `linked`,
 *      kick off a first sync.
 *   4. Redirect back to /settings/banks.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  // `state` is what we set on /auth (= pending connection id). Some legacy
  // pre-fix runs sent it as `cid` on the URL; fall through.
  const cid = url.searchParams.get("state") ?? url.searchParams.get("cid");
  // Locale was stashed in a cookie by /api/banks/connect because we can't
  // round-trip it via the redirect URL (Enable Banking enforces exact-match).
  const cookieJar = await cookies();
  const locale =
    cookieJar.get("marcio-bank-callback-locale")?.value ??
    url.searchParams.get("locale") ??
    "pt-BR";
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const code = url.searchParams.get("code");

  const back = (msg?: string) => {
    const res = NextResponse.redirect(
      new URL(
        `/${locale}/settings/banks${msg ? `?bank_status=${encodeURIComponent(msg)}` : ""}`,
        url.origin,
      ),
      { status: 302 },
    );
    // One-shot cookie — clear it on the way back regardless of outcome.
    res.cookies.set("marcio-bank-callback-locale", "", {
      maxAge: 0,
      path: "/",
    });
    return res;
  };

  if (!cid) return back("missing-cid");

  const [conn] = await db
    .select()
    .from(bankConnection)
    .where(eq(bankConnection.id, cid));
  if (!conn) return back("unknown-connection");

  if (error) {
    await db
      .update(bankConnection)
      .set({
        status: "error",
        lastError: `consent: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`.slice(
          0,
          500,
        ),
      })
      .where(eq(bankConnection.id, cid));
    return back("consent-error");
  }

  if (!code) return back("missing-code");

  try {
    const session = await createSession(code);

    await db
      .update(bankConnection)
      .set({
        sessionIdEncrypted: encryptSecret(session.session_id),
        status: "linked",
        lastError: null,
        redirectLink: null,
        expiresAt: session.access_valid_until
          ? new Date(session.access_valid_until)
          : conn.expiresAt,
      })
      .where(eq(bankConnection.id, cid));

    // Best-effort first sync. Failures here are not fatal — the cron retries.
    try {
      await syncConnection(cid);
    } catch {
      // syncConnection records lastError on the row; swallow.
    }

    return back("linked");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(bankConnection)
      .set({ status: "error", lastError: msg.slice(0, 500) })
      .where(eq(bankConnection.id, cid));
    return back("error");
  }
}
