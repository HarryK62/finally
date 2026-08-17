/**
 * PLAN.md §12 — "Fresh start: default watchlist appears, $10k balance shown,
 * prices are streaming".
 *
 * This spec is the only one that may assert absolute balances, because it runs
 * first against a database created moments ago by the webServer launch.
 */

import { expect, test } from "@playwright/test";

import {
  DEFAULT_TICKERS,
  connectionStatus,
  expectPricesToMove,
  headerStat,
  openTerminal,
  panel,
  positionsPanel,
  watchlistPrice,
  watchlistPrices,
  watchlistSelect,
} from "../support/terminal";

test.describe.configure({ mode: "serial" });

test("health reports the simulator and the mocked LLM", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    market_source: "simulator",
    llm_mock: true,
  });
});

test("seeds ten tickers and $10,000 of cash", async ({ page }) => {
  await openTerminal(page);

  await expect(watchlistPrices(page)).toHaveCount(DEFAULT_TICKERS.length);
  for (const ticker of DEFAULT_TICKERS) {
    await expect(watchlistSelect(page, ticker)).toBeVisible();
  }

  await expect(headerStat(page, "Cash")).toHaveText("$10,000.00");
  await expect(headerStat(page, "Portfolio Value")).toHaveText("$10,000.00");
  await expect(headerStat(page, "Unrealized P&L")).toHaveText(/\+\$0\.00/);

  await expect(positionsPanel(page)).toContainText("No positions yet");
});

test("streams prices for every watched ticker", async ({ page }) => {
  await openTerminal(page);

  // Every row must be quoting before we can claim the feed is healthy.
  for (const ticker of DEFAULT_TICKERS) {
    await expect(watchlistPrice(page, ticker)).not.toHaveText("—");
  }

  await expectPricesToMove(page);
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
});

test("accumulates a session chart for the selected ticker", async ({ page }) => {
  await openTerminal(page);
  await watchlistSelect(page, "AAPL").click();

  // The main chart is fed by the client-side ring buffer, so it fills in from
  // the stream rather than from a REST call.
  await expect(panel(page, "AAPL · Session")).toBeVisible();
  await expect(panel(page, "AAPL · Session").locator("svg.recharts-surface")).toBeVisible();
});
