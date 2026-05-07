import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankConnection } from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { startAuth } from "@/lib/enable_banking/client.ts";

/**
 * GET /api/banks/connect?aspsp=<name>&country=<NL>&days=<90|180>&locale=<…>
 *
 * Mints an Enable Banking authorization for the signed-in user, persists a
 * `pending` bank_connection row, and 302s to the hosted consent link. The
 * `state` we pass is the connection id, which round-trips back via the
 * callback URL so we can find this row and exchange the code for a session.
 *
 * Defaults to ING NL (`aspsp=ING`, `country=NL`).
 */

export const dynamic = "force-dynamic";

const DEFAULT_ASPSP = "ING";
const DEFAULT_COUNTRY = "NL";
const DEFAULT_VALID_DAYS = 180;

export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const aspsp = url.searchParams.get("aspsp") ?? DEFAULT_ASPSP;
  const country = url.searchParams.get("country") ?? DEFAULT_COUNTRY;
  const locale = url.searchParams.get("locale") ?? "pt-BR";
  const daysParam = Number.parseInt(
    url.searchParams.get("days") ?? String(DEFAULT_VALID_DAYS),
    10,
  );
  const days = Number.isFinite(daysParam)
    ? Math.max(1, Math.min(180, daysParam))
    : DEFAULT_VALID_DAYS;

  const [pending] = await db
    .insert(bankConnection)
    .values({
      owner: me.role,
      institutionId: `${aspsp}_${country}`,
      status: "pending",
    })
    .returning();

  // Enable Banking validates `redirect_url` against the URL registered in
  // their dashboard with exact-match rules — appending query params would
  // trigger REDIRECT_URI_NOT_ALLOWED. Keep the URL bare and round-trip the
  // connection id via `state` (which Enable Banking echoes back) and the
  // locale via a short-lived cookie that the callback reads.
  const callbackUrl = `${url.origin}/api/banks/callback`;
  const validUntil = new Date(Date.now() + days * 86400_000);

  try {
    const auth = await startAuth({
      access: { valid_until: validUntil.toISOString() },
      aspsp: { name: aspsp, country },
      state: pending.id,
      redirect_url: callbackUrl,
      psu_type: "personal",
      // Enable Banking validates language against ISO 639-1 (^[a-z]{2}$).
      // Hardcoded "en" — the bank's own consent page will still localize for
      // NL users, and this keeps the param invariant across our own locales.
      language: "en",
    });

    await db
      .update(bankConnection)
      .set({
        redirectLink: auth.url,
        expiresAt: validUntil,
      })
      .where(eq(bankConnection.id, pending.id));

    const response = NextResponse.redirect(auth.url, { status: 302 });
    // Stash the locale so the callback can land the user back on their
    // preferred /[locale]/settings/banks. 30 min is plenty for the consent
    // flow at the bank; expires automatically afterwards.
    response.cookies.set("marcio-bank-callback-locale", locale, {
      maxAge: 60 * 30,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(bankConnection)
      .set({ status: "error", lastError: msg.slice(0, 500) })
      .where(eq(bankConnection.id, pending.id));
    const back = new URL(
      `/${locale}/settings/banks?bank_error=${encodeURIComponent(msg.slice(0, 200))}`,
      url.origin,
    );
    return NextResponse.redirect(back, { status: 302 });
  }
}
