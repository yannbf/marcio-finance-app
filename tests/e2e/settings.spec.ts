import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test("renders banks/savings/inbox links + payday + theme + language", async ({
    page,
  }) => {
    await page.goto("/en/settings");
    await expect(
      page.getByRole("heading", { name: /Configuration/ }),
    ).toBeVisible();
    await expect(page.getByText("Banks & accounts")).toBeVisible();
    await expect(page.getByText("Savings accounts")).toBeVisible();
    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(page.getByText(/Month rollover/)).toBeVisible();
    await expect(page.getByText(/Theme/)).toBeVisible();
    // Sign-out present because dev user is signed in.
    await expect(
      page.getByRole("button", { name: /Sign out/ }),
    ).toBeVisible();
  });

  test("theme dropdown switches html.dark on pick", async ({ page }) => {
    await page.goto("/en/settings");
    // Default storage value is "dark" — html should have .dark.
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);

    // Open the theme Select and pick Light.
    await page.getByRole("combobox", { name: /Theme/ }).click();
    await page.getByRole("option", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(
      /(?:^|\s)dark(?:\s|$)/,
    );
    expect(
      await page.evaluate(() => localStorage.getItem("marcio-theme")),
    ).toBe("light");

    // Flip back so subsequent tests don't see a light theme.
    await page.getByRole("combobox", { name: /Theme/ }).click();
    await page.getByRole("option", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
  });
});
