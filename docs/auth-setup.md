# Auth setup — Google OAuth

Marcio uses **Google OAuth** as the only sign-in method, gated by a
hard-coded **two-email allow-list** so only the household can ever create
an account, regardless of who clicks the Google button.

The whole flow runs through Better Auth. App code is in
`src/lib/auth/index.ts` (server config) and `src/lib/auth/client.ts`
(client SDK). The allow-list / role mapping lives in
`src/lib/auth/config.ts`.

## What you need

- A Google account that controls a Google Cloud project (any free project
  is fine; no billing required).
- The two emails that should be able to sign in (Yann + Camila).
- The base URL the app will run from in each environment (e.g.
  `http://localhost:3000` for dev, `https://marcio.example.com` for prod).

## Google Cloud Console — one-time setup

1. Open <https://console.cloud.google.com/> and either pick or create a
   project (e.g. "Marcio").
2. **OAuth consent screen** — `APIs & Services → OAuth consent screen`:
   - User type: **External** (Internal needs a Workspace).
   - App name: `Marcio`. Support email: yours.
   - Add an "App home page" URL — your prod URL is fine.
   - On the "Scopes" step, keep just `userinfo.email`, `userinfo.profile`,
     and `openid` (the defaults Better Auth requests).
   - On the "Test users" step, add **both** household emails. Without
     this, only your own Google account can complete the flow while the
     app is in test mode.
   - You can leave the app in **Testing** state forever — there's no
     reason to publish since only two accounts will ever sign in.
3. **OAuth credentials** — `APIs & Services → Credentials → Create
   credentials → OAuth client ID`:
   - Application type: **Web application**.
   - Name: `Marcio (dev)` or `Marcio (prod)` — make one per environment.
   - **Authorized redirect URIs**: add one entry per environment, exactly
     of the form:

     ```
     https://your-domain/api/auth/callback/google
     http://localhost:3000/api/auth/callback/google
     ```

     The path is fixed by Better Auth (`/api/auth/callback/{providerId}`).
     Add both dev and prod URIs to the same client if you want; otherwise
     create one client per environment.
   - Save. Copy the **Client ID** and **Client secret**.

## Environment variables

Set these in `.env.local` (dev) and in Vercel project settings (prod):

```
# OAuth credentials from Google Cloud Console
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>

# Better Auth base URL — must match the redirect URI's origin
BETTER_AUTH_URL=http://localhost:3000           # dev
# BETTER_AUTH_URL=https://marcio.example.com    # prod

# Origins the app trusts (comma-separated, no path)
MARCIO_TRUSTED_ORIGINS=http://localhost:3000

# Random 32-byte secret. Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=...

# Closed allow-list (lowercase, comma-separated)
MARCIO_ALLOWED_EMAILS=yann@example.com,camila@example.com

# Role mapping — used to assign user.role on first sign-in
MARCIO_EMAIL_YANN=yann@example.com
MARCIO_EMAIL_CAMILA=camila@example.com
```

The dev bypass is unchanged — set `MARCIO_DEV_AS=yann` (or `camila`) in
`.env.local` to short-circuit OAuth entirely while iterating locally.
The bypass is hard-gated to `NODE_ENV !== "production"`.

## How the allow-list is enforced

When Google completes the OAuth handshake, Better Auth tries to upsert a
row in the `user` table. We intercept that in
`databaseHooks.user.create.before`:

- If the email isn't in `MARCIO_ALLOWED_EMAILS`, the hook returns `false`
  → no user row is written → the OAuth handshake errors out → the user
  bounces back to `/sign-in`.
- If the email matches, the hook injects `role: "yann" | "camila"` based
  on `MARCIO_EMAIL_*`, since that column is `NOT NULL` in our schema.

Existing users (already created on a previous sign-in) skip the `before`
hook on subsequent logins — the row is already there.

## Testing the flow

1. Make sure `MARCIO_DEV_AS` is **unset** in `.env.local` (otherwise the
   bypass takes over before you reach the OAuth flow).
2. Restart `pnpm dev`.
3. Visit `http://localhost:3000/en/sign-in`. Click *Continue with Google*.
4. Pick the Google account whose email is on the allow-list.
5. You land on `/` with a session cookie set. The `Settings` page now
   shows your email and a *Sign out* button.

Sign-in attempts from off-list emails redirect back to `/sign-in` with
no error visible to the user (intentional — we don't reveal who's on the
allow-list).

## Common problems

- **`redirect_uri_mismatch`** — the URI in Google Cloud doesn't match
  exactly what Better Auth sent. Check both protocol (http vs https) and
  the trailing path (`/api/auth/callback/google`).
- **`access_denied` after the Google account picker** — your account
  isn't on the OAuth consent screen's *Test users* list. Add it.
- **Sign-in succeeds but you bounce to `/sign-in` immediately** — the
  email isn't on `MARCIO_ALLOWED_EMAILS`, or `MARCIO_EMAIL_YANN` /
  `MARCIO_EMAIL_CAMILA` doesn't match exactly. Both are case-folded.
- **Production: `BETTER_AUTH_URL` mismatch** — Better Auth derives the
  callback URL from this; if it's wrong, the redirect URI Google sees
  won't match what you registered.
