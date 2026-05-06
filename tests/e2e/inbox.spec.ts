import { test, expect } from "@playwright/test";

test.describe("Inbox", () => {
  test("lists unmatched transactions from the seed", async ({ page }) => {
    await page.goto("/en/inbox");
    await expect(
      page.getByRole("heading", { name: "Needs categorizing" }),
    ).toBeVisible();
    // The three Mystery Vendor txns are unmatched and visible to the joint
    // scope; Yann personal Mystery is also visible since dev user is yann.
    await expect(page.getByText("Mystery Vendor One")).toBeVisible();
    await expect(page.getByText("Mystery Vendor Two")).toBeVisible();
    await expect(page.getByText("Mystery Vendor Three")).toBeVisible();
  });

  test("opens the per-row picker on click", async ({ page }) => {
    await page.goto("/en/inbox");
    // Click into the row's popover trigger (the inner InboxRow button).
    const row = page
      .locator("li")
      .filter({ hasText: "Mystery Vendor One" });
    await row.locator("button").first().click();
    // The popover header reads "Assign to".
    await expect(
      page.getByText(/Assign to/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("bulk-action bar appears when selecting multiple rows", async ({
    page,
  }) => {
    await page.goto("/en/inbox");
    const checkboxes = page.locator(
      "li input[type=checkbox][aria-label='Select all']",
    );
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await expect(page.getByText(/2 selected/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Assign 2/ }),
    ).toBeVisible();
    // Clear button drops the selection.
    await page.getByRole("button", { name: /^Clear$/ }).click();
    await expect(page.getByText(/2 selected/)).toHaveCount(0);
  });
});
