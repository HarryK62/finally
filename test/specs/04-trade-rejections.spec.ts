/**
 * Rejected orders must surface in the UI, not just in the network tab.
 *
 * Both messages are the backend's `detail` strings from CONTRACTS.md §5, so this
 * also pins that the terminal renders `{"detail": "..."}` rather than a generic
 * "something went wrong".
 */

import { expect, test } from "@playwright/test";

import {
  openTerminal,
  placeOrder,
  positionRow,
  readStat,
  tradeError,
  tradeFill,
} from "../support/terminal";

test.describe.configure({ mode: "serial" });

test("a buy beyond the cash balance is rejected and explained", async ({ page }) => {
  await openTerminal(page);
  const cashBefore = await readStat(page, "Cash");

  await placeOrder(page, "AAPL", 100_000, "buy");

  await expect(tradeError(page)).toHaveText(/^Insufficient cash: need \$[\d,]+\.\d{2}, have \$/);
  await expect(tradeFill(page)).toHaveCount(0);
  await expect(positionRow(page, "AAPL")).toHaveCount(0);
  expect(await readStat(page, "Cash")).toBeCloseTo(cashBefore, 2);
});

test("selling shares that are not held is rejected and explained", async ({ page }) => {
  await openTerminal(page);
  const cashBefore = await readStat(page, "Cash");

  await placeOrder(page, "V", 500, "sell");

  await expect(tradeError(page)).toHaveText(/^Insufficient shares: trying to sell 500, hold /);
  await expect(tradeFill(page)).toHaveCount(0);
  expect(await readStat(page, "Cash")).toBeCloseTo(cashBefore, 2);
});

test("a non-positive quantity never reaches the backend", async ({ page }) => {
  await openTerminal(page);

  await placeOrder(page, "AAPL", 0, "buy");

  await expect(tradeError(page)).toHaveText("Quantity must be greater than zero");
});
