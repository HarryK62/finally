/**
 * SPA routing, per CONTRACTS.md §9: the static mount is registered last, an
 * unknown non-`/api` path serves `index.html`, and an unknown `/api` path stays
 * a JSON 404 so an API mistake is never masked by an HTML page.
 *
 * The Next.js export ships its own `404.html`, which `StaticFiles(html=True)`
 * will happily return as an ordinary 404 response rather than raising — so a
 * deep link is checked on both the status code and the rendered terminal, not
 * on the status code alone.
 */

import { expect, test } from "@playwright/test";

import { connectionStatus, headerStat, watchlistPrices } from "../support/terminal";

test.describe.configure({ mode: "serial" });

test("a deep link serves the terminal, not the export's 404 page", async ({ page }) => {
  const response = await page.goto("/positions/AAPL");

  expect(response?.status(), "unknown non-/api paths fall back to index.html").toBe(200);

  // Status 200 alone would also be satisfied by a 404.html rendered at 200, so
  // require the terminal itself: the header loads and the feed connects.
  await expect(headerStat(page, "Cash")).not.toHaveText("—");
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
  await expect(watchlistPrices(page)).toHaveCount(10);
  await expect(page.locator("body")).not.toContainText("This page could not be found");
});

test("an unknown API path stays a JSON 404", async ({ request }) => {
  const response = await request.get("/api/does-not-exist");

  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({ detail: "Not Found" });
});

test("an unknown API path under a real router prefix is also a JSON 404", async ({ request }) => {
  const response = await request.get("/api/portfolio/nope");

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ detail: "Not Found" });
});

test("a reload of a deep link keeps working", async ({ page }) => {
  await page.goto("/settings/anything");
  await expect(headerStat(page, "Cash")).not.toHaveText("—");

  await page.reload();

  await expect(headerStat(page, "Cash")).not.toHaveText("—");
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
});
