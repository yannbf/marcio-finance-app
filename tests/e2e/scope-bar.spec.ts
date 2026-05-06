import { test, expect } from "@playwright/test";

const PAGES_WITH_BAR = ["/en", "/en/month", "/en/activity", "/en/insights", "/en/transactions", "/en/buckets", "/en/tikkie"] as const;

test.describe("MonthScopeBar coverage", () => {
  for (const path of PAGES_WITH_BAR) {
    test(`${path} renders the month picker + scope toggle`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(
        page.getByRole("button", { name: "Previous month" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Next month" }),
      ).toBeVisible();
      // Scope is a dropdown — its trigger has the current label "Joint".
      await expect(
        page.getByRole("combobox").filter({ hasText: "Joint" }),
      ).toBeVisible();
    });
  }

  test("URL anchor parameter survives nav between pages", async ({ page }) => {
    await page.goto("/en/activity?anchor=2026-04");
    await expect(page.getByText(/Apr\s+2026/i).first()).toBeVisible();
  });
});
