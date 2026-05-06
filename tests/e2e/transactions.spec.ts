import { test, expect } from "@playwright/test";

test.describe("Transactions full history", () => {
  test("renders header, search input, filter pills", async ({ page }) => {
    await page.goto("/en/transactions");
    await expect(page.getByRole("heading", { name: /All/ })).toBeVisible();
    await expect(page.locator('input[name="q"]')).toBeVisible();
    // Filter pills are links: All / Matched / Unmatched.
    await expect(
      page.getByRole("link", { name: /All/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Matched/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Unmatched/ })).toBeVisible();
  });

  test("Unmatched filter narrows the list", async ({ page }) => {
    await page.goto("/en/transactions?show=unmatched");
    // Acme Property is matched in the seed → should NOT appear.
    await expect(page.getByText("Acme Property")).toHaveCount(0);
    // Mystery Vendor One is unmatched → SHOULD appear.
    await expect(page.getByText("Mystery Vendor One")).toBeVisible();
  });
});
