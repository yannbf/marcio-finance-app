import { test, expect } from "@playwright/test";

test.describe("Tikkie page", () => {
  test("groups by parsed person + shows totals", async ({ page }) => {
    await page.goto("/en/tikkie");
    await expect(
      page.getByRole("heading", { name: "By person" }),
    ).toBeVisible();
    await expect(page.getByText(/Paid out/i)).toBeVisible();
    await expect(page.getByText(/Received/i)).toBeVisible();

    // The seed has Alpha and Beta as Tikkie counterparties.
    // After the Postgres regex fix, they MUST appear here.
    await expect(page.getByText("Alpha", { exact: false })).toBeVisible();
    await expect(page.getByText("Beta", { exact: false })).toBeVisible();
  });

  test("Insights links across to Tikkie", async ({ page }) => {
    await page.goto("/en/insights");
    await page.getByRole("link", { name: /By person/ }).click();
    await expect(page).toHaveURL(/\/en\/tikkie$/);
  });

  test("MonthScopeBar is mounted on /tikkie", async ({ page }) => {
    await page.goto("/en/tikkie");
    await expect(
      page.getByRole("button", { name: "Previous month" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Joint" }),
    ).toBeVisible();
  });
});
