import { test, expect } from "@playwright/test";

test.describe("Insights", () => {
  test("shows section breakdown + top merchants from the seed", async ({
    page,
  }) => {
    await page.goto("/en/insights");
    await expect(
      page.getByRole("heading", { name: /Where the money went/ }),
    ).toBeVisible();
    // Top categories card.
    await expect(page.getByText("Top categories")).toBeVisible();
    // Top merchants card. Foobar Market is the most-frequent merchant in
    // the seed (two grocery txns) so it should land in the list.
    await expect(page.getByText("Top merchants")).toBeVisible();
    await expect(page.getByText("Foobar Market")).toBeVisible();
  });
});
