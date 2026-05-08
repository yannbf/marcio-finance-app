/**
 * Playwright globalSetup. Boots a PGlite-backed Postgres on a fixed port,
 * pushes the schema, runs the seed, then spawns the Next.js dev server
 * pointed at it. Replaces the previous setup that required
 * `MARCIO_E2E_DATABASE_URL` to point at a real (Neon) branch.
 *
 * Why we don't use Playwright's built-in `webServer` config: with
 * `MARCIO_DEV_AS=yann` set, every dev-server request goes through
 * `ensureDevUser()` which hits the DB. Playwright's `webServer` becomes
 * "ready" by polling a URL — but globalSetup runs *after* that polling
 * finishes, which means the dev server crashes on its first ready-check
 * because there's no DB yet. Spawning the dev server here, after PGlite
 * is up, sequences the boot correctly.
 *
 * Why a fixed port and not a random one? Playwright resolves the dev
 * server config at module evaluation time, well before globalSetup. We
 * pick a predictable port (5544 default; override with MARCIO_E2E_PG_PORT)
 * and make sure both ends agree.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { startTestPg } from "../../support/pglite-server.ts";
import { PG_PORT, PORT, BASE_URL } from "../../../playwright.config.ts";

const HANDOFF_DIR = path.resolve(".playwright-cache");
const HANDOFF_FILE = path.join(HANDOFF_DIR, "pglite-handle.json");

declare global {
  // eslint-disable-next-line no-var
  var __marcioE2eTestPg:
    | Awaited<ReturnType<typeof startTestPg>>
    | undefined;
  // eslint-disable-next-line no-var
  var __marcioE2eDevServer: ChildProcess | undefined;
}

async function waitForReadable(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Even a 200 OR a 500 means Next is alive — we just need its router
      // to be up. globalSetup will have populated the DB so any 500 is
      // legitimately a server bug, not a boot race.
      if (res.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `[e2e] dev server didn't become ready in ${timeoutMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export default async function globalSetup() {
  console.log(`[e2e] booting PGlite socket on 127.0.0.1:${PG_PORT}…`);
  const testPg = await startTestPg({ port: PG_PORT });
  globalThis.__marcioE2eTestPg = testPg;

  // Persist a tiny breadcrumb so globalTeardown (separate module load) can
  // identify the right server when needed. Also exposes the URL for
  // ad-hoc debugging (`psql $(jq -r .url .playwright-cache/...)`).
  mkdirSync(HANDOFF_DIR, { recursive: true });
  writeFileSync(
    HANDOFF_FILE,
    JSON.stringify({ url: testPg.url, port: PG_PORT }, null, 2),
  );

  console.log("[e2e] running seed against PGlite…");
  // Async spawn — `spawnSync` blocks the parent's event loop, which
  // starves the in-process PGlite socket and the child's connect call
  // times out. With `spawn` the socket keeps accepting connections
  // while we await the child's exit.
  const seedExit = await new Promise<number>((resolve, reject) => {
    const seed = spawn("pnpm", ["tsx", "tests/e2e/setup/seed.ts"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testPg.url },
    });
    seed.on("exit", (code) => resolve(code ?? 1));
    seed.on("error", reject);
  });
  if (seedExit !== 0) {
    await testPg.stop();
    globalThis.__marcioE2eTestPg = undefined;
    throw new Error(`Seed exited with status ${seedExit}`);
  }

  console.log(`[e2e] starting Next dev server on :${PORT}…`);
  const dev = spawn("pnpm", ["dev", "-p", String(PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      MARCIO_DEV_AS: "yann",
      MARCIO_E2E: "1",
      DATABASE_URL: testPg.url,
      NODE_ENV: "development",
    },
  });
  globalThis.__marcioE2eDevServer = dev;
  dev.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[e2e] dev server exited with code ${code}`);
    }
  });

  await waitForReadable(`${BASE_URL}/en/sign-in`);
  console.log(`[e2e] dev server ready at ${BASE_URL}`);
}
