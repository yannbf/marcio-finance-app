import { test, expect } from "@playwright/test";

test.describe("Today / Home screen", () => {
  test("renders the bottom-nav and the headline summary", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("nav.fixed")).toBeVisible();
    // Bottom-nav has 5 tabs.
    await expect(
      page.locator("nav.fixed").getByRole("link"),
    ).toHaveCount(5);
    // The page mentions a planned-vs-spent summary or the empty hint.
    await expect(
      page
        .getByText(/Spent so far|All caught up|until payday/)
        .first(),
    ).toBeVisible();
  });

  test("nav links route between sections", async ({ page }) => {
    await page.goto("/en");
    await page.locator("nav.fixed").getByRole("link").nth(1).click();
    await expect(page).toHaveURL(/\/en\/month$/);
    await page.locator("nav.fixed").getByRole("link").nth(2).click();
    await expect(page).toHaveURL(/\/en\/activity$/);
    await page.locator("nav.fixed").getByRole("link").nth(4).click();
    await expect(page).toHaveURL(/\/en\/settings$/);
  });
});
