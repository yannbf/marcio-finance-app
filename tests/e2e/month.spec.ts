import { test, expect } from "@playwright/test";

test.describe("Month screen", () => {
  test("shows seeded sections and budget items", async ({ page }) => {
    await page.goto("/en/month?scope=joint");
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible();
    // Fixed and Variable sections from the seed both have items.
    await expect(page.getByText("Rent")).toBeVisible();
    await expect(page.getByText("Groceries")).toBeVisible();
    // Income column should reflect the salary pool from the seed.
    await expect(page.getByText("Income").first()).toBeVisible();
  });

  test("scope toggle persists in a cookie across reloads", async ({
    page,
    context,
  }) => {
    await page.goto("/en/month");
    // Two pills: Joint + Me. Click Me.
    await page.getByRole("button", { name: /^Me$/ }).click();
    // Wait for the cookie to land before reloading.
    await expect.poll(async () => {
      const cookies = await context.cookies();
      return cookies.find((c) => c.name === "marcio-month-scope")?.value;
    }).toBe("me");

    await page.goto("/en/month");
    // Active pill should still be Me — its aria-current should be "true".
    await expect(
      page.getByRole("button", { name: /^Me$/ }),
    ).toHaveAttribute("aria-current", "true");
  });
});
