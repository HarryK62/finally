/**
 * PLAN.md §12 — "Add and remove a ticker from the watchlist".
 *
 * Leaves the watchlist exactly as it found it so later specs still see the ten
 * seeded symbols.
 */

import { expect, test } from "@playwright/test";

import {
  addWatchlistTicker,
  openTerminal,
  watchlistError,
  watchlistPrice,
  watchlistPrices,
  watchlistRemove,
  watchlistSelect,
} from "../support/terminal";

const EXTRA = "PYPL";

test.describe.configure({ mode: "serial" });

test("adds a ticker, streams it, then removes it", async ({ page }) => {
  await openTerminal(page);
  const initialCount = await watchlistPrices(page).count();

  await addWatchlistTicker(page, EXTRA);

  await expect(watchlistSelect(page, EXTRA)).toBeVisible();
  await expect(watchlistPrices(page)).toHaveCount(initialCount + 1);
  // A newly watched symbol must be picked up by the live feed, not just the DB.
  await expect(watchlistPrice(page, EXTRA)).not.toHaveText("—");

  await watchlistRemove(page, EXTRA).click();

  await expect(watchlistSelect(page, EXTRA)).toHaveCount(0);
  await expect(watchlistPrices(page)).toHaveCount(initialCount);
});

test("rejects a duplicate ticker in the UI", async ({ page }) => {
  await openTerminal(page);
  const initialCount = await watchlistPrices(page).count();

  await addWatchlistTicker(page, "AAPL");

  await expect(watchlistError(page)).toHaveText("AAPL is already in the watchlist");
  await expect(watchlistPrices(page)).toHaveCount(initialCount);
});

test("rejects an invalid symbol in the UI", async ({ page }) => {
  await openTerminal(page);
  const initialCount = await watchlistPrices(page).count();

  await addWatchlistTicker(page, "123");

  await expect(watchlistError(page)).toHaveText("Invalid ticker symbol");
  await expect(watchlistPrices(page)).toHaveCount(initialCount);
});
