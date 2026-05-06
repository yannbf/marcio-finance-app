import { test, expect } from "@playwright/test";

test.describe("Buckets", () => {
  test("renders the SAZONAIS items as monthly contributions", async ({
    page,
  }) => {
    await page.goto("/en/buckets");
    await expect(
      page.getByRole("heading", { name: /Monthly contributions/ }),
    ).toBeVisible();
    // The seed has two SAZONAIS items: "Yearly tax pot" and "Trip fund".
    // They live in the "Items not in a bucket" group since we don't seed
    // savings accounts. Both names should be visible.
    await expect(page.getByText("Yearly tax pot")).toBeVisible();
    await expect(page.getByText("Trip fund")).toBeVisible();
  });
});
