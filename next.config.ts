import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * ISO timestamp of the deployed commit, captured at build time.
 *
 * Vercel doesn't expose a commit timestamp as an env var, so we shell out
 * to git inside the build container. Falls back to "now" if git isn't
 * available (shallow-clone edge case or local builds outside a repo). The
 * result is inlined into `process.env.BUILD_COMMIT_TIME` via Next's `env`
 * config so both server and client code can read it.
 */
function captureBuildCommitTime(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const cmd = sha
      ? `git log -1 --format=%cI ${sha}`
      : "git log -1 --format=%cI";
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {
    // git unavailable or shallow clone — fall through.
  }
  return new Date().toISOString();
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Use a separate `.next-e2e` build dir for the Playwright dev server so
  // its dev-server lockfile (Next 16) doesn't collide with a `pnpm dev`
  // preview running in parallel — Next hard-exits the second `next dev`
  // when both share the same `.next/dev/lock`. Activated only by the
  // Playwright harness via MARCIO_E2E=1.
  ...(process.env.MARCIO_E2E === "1" ? { distDir: ".next-e2e" } : {}),
  // Next 16 blocks cross-origin requests to `_next/*` dev resources by
  // default. When the dev server binds to `0.0.0.0`/`127.0.0.1` and the
  // browser hits it via `127.0.0.1` (Playwright's default), the HMR /
  // turbopack client modules are blocked, which prevents the React tree
  // from hydrating and queries never fire. Allow-list 127.0.0.1 so the
  // E2E suite (and anyone running `next dev` against a non-`localhost`
  // host) can fetch its own dev assets.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // Enable React's <ViewTransition> hooks so the locale layout can wrap
    // the page tree and get free cross-fades on every nav.
    viewTransition: true,
  },
  env: {
    BUILD_COMMIT_TIME: captureBuildCommitTime(),
  },
};

export default withNextIntl(nextConfig);
