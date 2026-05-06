import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/index.ts";
import { isAllowed } from "./config.ts";

/**
 * Better Auth — magic-link only, closed allow-list, server-side checks at
 * every entrypoint. Password auth and OAuth are intentionally disabled.
 *
 * NB: this module reads DATABASE_URL at import time via the db proxy. In
 * environments where the DB is not yet configured, importing this file will
 * still succeed because the proxy is lazy — actual queries only run when a
 * sign-in request comes in.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustedOrigins: process.env.MARCIO_TRUSTED_ORIGINS?.split(",") ?? [],
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: false },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (!isAllowed(email)) {
          // Silent drop. Don't tell the world whether an email is on the list.
          return;
        }
        await sendLoginEmail(email, url);
      },
      expiresIn: 600,
    }),
  ],
});

async function sendLoginEmail(email: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MARCIO_FROM_EMAIL ?? "Marcio <onboarding@resend.dev>";
  if (!apiKey) {
    // Dev fallback — log the link so we can copy it. NEVER do this in prod.
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY missing in production.");
    }
    // eslint-disable-next-line no-console
    console.warn(`[marcio] dev magic link for ${email}: ${url}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Entrar no Marcio",
      text: `Click to sign in: ${url}\n\n(This link expires in 10 minutes.)`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend error: ${res.status} ${await res.text()}`);
  }
}
