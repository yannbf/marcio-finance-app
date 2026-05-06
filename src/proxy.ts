import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

const intlMiddleware = createMiddleware(routing);

const PUBLIC_SUBPATHS = ["/sign-in"];

export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // Skip in dev when MARCIO_DEV_AS bypass is in effect.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.MARCIO_DEV_AS
  ) {
    return response;
  }

  const { pathname } = request.nextUrl;

  // Strip locale prefix for path matching: "/en/sign-in" → "/sign-in".
  const stripped = stripLocale(pathname);
  if (PUBLIC_SUBPATHS.some((p) => stripped === p || stripped.startsWith(`${p}/`))) {
    return response;
  }

  // Better Auth's cookie names — both "." and "-" variants exist depending
  // on browser cookie handling. Either presence is enough to attempt a
  // protected page; getCurrentUser() does the real validation server-side.
  const hasSession =
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("better-auth-session_token") ||
    request.cookies.has("__Secure-better-auth.session_token");
  if (hasSession) return response;

  // No session → redirect to /sign-in, preserving the current locale.
  const locale = extractLocale(pathname) ?? routing.defaultLocale;
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/sign-in`;
  url.search = "";
  return NextResponse.redirect(url);
}

function extractLocale(pathname: string): string | null {
  const seg = pathname.split("/")[1];
  return (routing.locales as readonly string[]).includes(seg) ? seg : null;
}

function stripLocale(pathname: string): string {
  const locale = extractLocale(pathname);
  if (!locale) return pathname;
  const rest = pathname.slice(locale.length + 1);
  return rest.length === 0 ? "/" : rest;
}

export const config = {
  matcher: [
    // Skip Next.js internals, API routes, and static files
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
