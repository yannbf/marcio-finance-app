/**
 * Playwright globalTeardown. Stops the dev server + PGlite socket
 * started in globalSetup. Best-effort — Playwright kills the worker
 * process anyway, but cleaning up explicitly avoids "address still in
 * use" on quick back-to-back runs.
 */

export default async function globalTeardown() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  if (g.__marcioE2eDevServer) {
    try {
      g.__marcioE2eDevServer.kill("SIGTERM");
      // Give Next a moment to flush; force-kill if it lingers.
      await new Promise((r) => setTimeout(r, 500));
      if (!g.__marcioE2eDevServer.killed) {
        g.__marcioE2eDevServer.kill("SIGKILL");
      }
    } catch (err) {
      console.warn("[e2e] dev server teardown failed:", err);
    }
    g.__marcioE2eDevServer = undefined;
  }

  if (g.__marcioE2eTestPg) {
    try {
      await g.__marcioE2eTestPg.stop();
    } catch (err) {
      console.warn("[e2e] PGlite teardown failed:", err);
    }
    g.__marcioE2eTestPg = undefined;
  }
}
