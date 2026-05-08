import { test, expect } from "@playwright/test";

/**
 * The harness runs the dev server with MARCIO_DEV_AS=yann so every other
 * page renders as a signed-in user. That synthetic session also
 * short-circuits `/sign-in`: the page itself calls `getCurrentUser()`,
 * sees the dev user, and redirects to `/`. To exercise the sign-in
 * screen we need to bypass the bypass — which means a separate dev-server
 * run with MARCIO_DEV_AS unset.
 *
 * Rather than spin a second server here we skip these tests by default
 * and gate them behind `MARCIO_E2E_TEST_AUTH=1`. That env var is opt-in:
 * a contributor who wants to verify the sign-in markup explicitly
 * launches a no-bypass dev server (see TESTING.md) and runs the suite
 * against it.
 */
const RUN_AUTH_TESTS = process.env.MARCIO_E2E_TEST_AUTH === "1";

test.describe("Sign-in screen", () => {
  test.skip(
    !RUN_AUTH_TESTS,
    "Sign-in tests need a dev server without MARCIO_DEV_AS — set " +
      "MARCIO_E2E_TEST_AUTH=1 and disable the dev bypass before running.",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("renders Google button and hides bottom-nav", async ({ page }) => {
    await page.goto("/en/sign-in");
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.getByTestId("sign-in-google")).toBeVisible();
    await expect(
      page.getByText("Continue with the Google account"),
    ).toBeVisible();
    await expect(page.locator("nav.fixed")).toHaveCount(0);
  });

  test("renders Portuguese strings under /pt-BR", async ({ page }) => {
    await page.goto("/pt-BR/sign-in");
    await expect(
      page.getByRole("heading", { name: "Bem-vindo de volta" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continuar com Google/ }),
    ).toBeVisible();
  });
});
