import { test, expect } from "@playwright/test";

test.describe("Activity screen", () => {
  test("groups transactions by date and shows month-spend summary", async ({
    page,
  }) => {
    await page.goto("/en/activity");
    await expect(
      page.getByRole("heading", { name: "This month" }),
    ).toBeVisible();
    // Spent-this-month card.
    await expect(page.getByText("Spent this month")).toBeVisible();
    // Seed includes Acme Property; should be in the timeline.
    await expect(page.getByText("Acme Property")).toBeVisible();
    // Cross-link at the bottom to the full history.
    await expect(
      page.getByRole("link", { name: /See full history/ }),
    ).toBeVisible();
  });

  test("clicking a row opens the reassign picker", async ({ page }) => {
    await page.goto("/en/activity");
    const row = page.locator("li").filter({ hasText: "Acme Property" });
    await row.locator("button").first().click();
    await expect(
      page.getByText(/Assign to/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
