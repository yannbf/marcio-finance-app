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
