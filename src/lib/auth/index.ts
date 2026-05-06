import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/index.ts";
import { isAllowed, roleFor } from "./config.ts";

/**
 * Better Auth — Google OAuth only, closed allow-list, server-side checks at
 * every entrypoint. Email/password and other OAuth providers are intentionally
 * disabled.
 *
 * Allow-list enforcement happens in `databaseHooks.user.create.before`:
 * Google may hand us a verified email for any Google account, but we only
 * let the two configured emails actually create a Marcio account. Everyone
 * else gets rejected before a user row is written.
 *
 * NB: this module reads DATABASE_URL at import time via the db proxy. In
 * environments where the DB is not yet configured, importing this file will
 * still succeed because the proxy is lazy — actual queries only run when a
 * sign-in request comes in.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.MARCIO_TRUSTED_ORIGINS?.split(",")[0] ??
    "http://localhost:3000",
  trustedOrigins: process.env.MARCIO_TRUSTED_ORIGINS?.split(",") ?? [],
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: false },
  user: {
    // Tell Better Auth about our extra column so it gets persisted on
    // user creation AND included on every session payload. Without
    // this, session.user.role is undefined even when the column exists
    // in the DB, and getCurrentUser falls back to "no signed-in user".
    additionalFields: {
      role: { type: "string", required: true },
    },
  },
  session: {
    // 60 days. Visit at least once every two months and you stay
    // signed in indefinitely; each visit refreshes the cookie's expiry
    // back to "now + 60 days".
    expiresIn: 60 * 60 * 24 * 60,
    // Throttle the refresh-on-use to once per day so we don't hammer
    // the DB on every request — but still keep the cookie fresh.
    updateAge: 60 * 60 * 24,
    cookieCache: {
      // Cache the session in a signed cookie so getCurrentUser doesn't
      // have to hit Postgres on every request inside the 5-min window.
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (incoming) => {
          const email = String(incoming.email ?? "").toLowerCase();
          if (!isAllowed(email)) {
            // Stop the user-row insert. The OAuth callback then fails — we
            // don't reveal whether the email exists.
            return false;
          }
          const role = roleFor(email);
          if (!role) return false;
          return {
            data: {
              ...incoming,
              email,
              role,
              emailVerified: true,
            },
          };
        },
      },
    },
  },
});
