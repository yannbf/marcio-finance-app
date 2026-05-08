import { test, expect } from "@playwright/test";

test.describe("Month screen", () => {
  test("shows seeded sections and budget items", async ({ page }) => {
    await page.goto("/en/month?scope=joint");
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible();
    // Seed fixture has Mortgage (DIVIDAS) and Mercado (groceries) under
    // joint, plus the ENTRADAS (Income) section header.
    await expect(page.getByText("Mortgage")).toBeVisible();
    await expect(page.getByText("Mercado")).toBeVisible();
    await expect(page.getByText("Income").first()).toBeVisible();
  });

  test("scope toggle persists in a cookie across reloads", async ({
    page,
    context,
  }) => {
    await page.goto("/en/month");
    // Click the Me radio pill.
    await page.getByRole("radio", { name: "Me" }).click();
    await expect
      .poll(async () => {
        const cookies = await context.cookies();
        return cookies.find((c) => c.name === "marcio-month-scope")?.value;
      })
      .toMatch(/^(yann|camila)$/);

    // The MonthScopeBar reads the cookie on mount and pushes a URL with
    // `?scope=…` — that history.replaceState() interrupts the bare
    // `/en/month` goto unless we tell Playwright to expect the redirect.
    // Use `commit` (URL committed, no need to wait for full load) +
    // catch the race; then poll for the radio attribute that is the
    // actual contract being tested.
    await page.goto("/en/month", { waitUntil: "commit" }).catch(() => {});
    await expect(
      page.getByRole("radio", { name: "Me" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("month picker walks back and forward", async ({ page }) => {
    await page.goto("/en/month");
    // The picker exposes the current month as the text inside the
    // "Pick month" button. Reading it through aria-label keeps the
    // selector stable across i18n + visual tweaks.
    const label = page.getByRole("button", { name: "Pick month" });
    await expect(label).toHaveText(/[A-Z][a-z]{2,}\s+\d{4}/);
    const initial = (await label.textContent())?.trim();

    // Walk back one month — wait for the label to actually change rather
    // than re-reading textContent eagerly (which races with React state).
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(label).not.toHaveText(initial!);

    // Walk forward — should return to the initial label.
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
