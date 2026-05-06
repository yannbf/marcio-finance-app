import { test, expect } from "@playwright/test";

test.describe("Tikkie page", () => {
  test("groups by parsed person + shows totals", async ({ page }) => {
    await page.goto("/en/tikkie");
    await expect(
      page.getByRole("heading", { name: "By person" }),
    ).toBeVisible();
    // Headline cards.
    await expect(page.getByText(/Paid out/i)).toBeVisible();
    await expect(page.getByText(/Received/i)).toBeVisible();

    // Seed has Alpha and Beta as Tikkie counterparties.
    await expect(page.getByText("Alpha", { exact: false })).toBeVisible();
    await expect(page.getByText("Beta", { exact: false })).toBeVisible();
  });

  test("Insights links across to Tikkie", async ({ page }) => {
    await page.goto("/en/insights");
    await page.getByRole("link", { name: /By person/ }).click();
    await expect(page).toHaveURL(/\/en\/tikkie$/);
  });
});
