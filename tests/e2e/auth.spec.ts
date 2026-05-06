import { test, expect } from "@playwright/test";

test.describe("Sign-in screen", () => {
  test.beforeEach(async ({ context }) => {
    // Don't carry session cookies across tests in this file.
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
    // Bottom-nav must not render on the sign-in screen.
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
