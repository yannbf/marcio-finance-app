import { test, expect } from "@playwright/test";

test.describe("Month screen", () => {
  test("shows seeded sections and budget items", async ({ page }) => {
    await page.goto("/en/month?scope=joint");
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible();
    await expect(page.getByText("Rent")).toBeVisible();
    await expect(page.getByText("Groceries")).toBeVisible();
    await expect(page.getByText("Income").first()).toBeVisible();
  });

  test("scope toggle persists in a cookie across reloads", async ({
    page,
    context,
  }) => {
    await page.goto("/en/month");
    await page.getByRole("button", { name: /^Me$/ }).click();
    await expect
      .poll(async () => {
        const cookies = await context.cookies();
        return cookies.find((c) => c.name === "marcio-month-scope")?.value;
      })
      .toMatch(/^(yann|camila)$/);

    await page.goto("/en/month");
    await expect(
      page.getByRole("button", { name: /^Me$/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("month picker walks back and forward", async ({ page }) => {
    await page.goto("/en/month");
    // Read the initial month label out of the picker.
    const label = page.locator("nav, header").getByText(/[A-Z][a-z]{2,}\s+\d{4}/).first();
    const initial = (await label.textContent())?.trim();
    expect(initial).toBeTruthy();

    // Walk back one month.
    await page.getByRole("button", { name: "Previous month" }).click();
    const back = (await label.textContent())?.trim();
    expect(back).not.toBe(initial);

    // Walk forward — should return to the initial.
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(label).toHaveText(initial!);
  });

  test("URL anchor pre-selects the displayed month", async ({ page }) => {
    await page.goto("/en/month?anchor=2026-04");
    await expect(
      page.getByText(/Apr\s+2026/i).first(),
    ).toBeVisible();
  });
});
