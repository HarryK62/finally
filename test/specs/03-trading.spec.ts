/**
 * PLAN.md §12 — "Buy shares: cash decreases, position appears, portfolio
 * updates" and "Sell shares: cash increases, position updates or disappears".
 *
 * Cash is asserted as a delta against the notional printed in the fill
 * confirmation, never against a fixed balance: the fill price is whatever the
 * simulator was quoting at the instant the order hit the backend.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  headerStat,
  openTerminal,
  parseMoney,
  placeOrder,
  positionQuantity,
  positionRow,
  readStat,
  tradeFill,
  type TradeSide,
} from "../support/terminal";

const TICKER = "NVDA";

/** The `· $1,793.28` notional at the end of a fill confirmation. */
function fillTotal(text: string): number {
  const match = text.match(/·\s*(-?\$[\d,]+\.\d{2})/);
  expect(match, `could not read a notional out of "${text}"`).not.toBeNull();
  return parseMoney((match as RegExpMatchArray)[1]) as number;
}

/** Place an order and return the notional the terminal reported filling at. */
async function fill(page: Page, quantity: number, side: TradeSide): Promise<number> {
  await placeOrder(page, TICKER, quantity, side);

  const status = tradeFill(page);
  await expect(status).toBeVisible();
  await expect(status).toContainText(side === "buy" ? "Bought" : "Sold");
  return fillTotal((await status.textContent()) ?? "");
}

test.describe.configure({ mode: "serial" });

test("buying moves cash into a position and updates the header", async ({ page }) => {
  await openTerminal(page);

  const cashBefore = await readStat(page, "Cash");
  const valueBefore = await readStat(page, "Portfolio Value");
  expect(await positionQuantity(page, TICKER)).toBeNull();

  const notional = await fill(page, 4, "buy");

  await expect(positionRow(page, TICKER)).toHaveCount(1);
  expect(await positionQuantity(page, TICKER)).toBeCloseTo(4, 6);

  const cashAfter = await readStat(page, "Cash");
  expect(cashAfter).toBeCloseTo(cashBefore - notional, 2);
  expect(cashAfter).toBeLessThan(cashBefore);

  // Total value is cash + positions: it only moves by the price drift between
  // the fill and the read, not by the size of the trade.
  const valueAfter = await readStat(page, "Portfolio Value");
  expect(Math.abs(valueAfter - valueBefore)).toBeLessThan(notional * 0.1);

  // Cost basis is now non-zero, so the positions footer must say so.
  await expect(headerStat(page, "Return")).not.toHaveText("—");
});

test("a partial sell returns cash and shrinks the position", async ({ page }) => {
  await openTerminal(page);
  expect(await positionQuantity(page, TICKER)).toBeCloseTo(4, 6);

  const cashBefore = await readStat(page, "Cash");
  const notional = await fill(page, 1.5, "sell");

  expect(await positionQuantity(page, TICKER)).toBeCloseTo(2.5, 6);

  const cashAfter = await readStat(page, "Cash");
  expect(cashAfter).toBeCloseTo(cashBefore + notional, 2);
  expect(cashAfter).toBeGreaterThan(cashBefore);
});

test("selling the remainder removes the position row", async ({ page }) => {
  await openTerminal(page);
  const held = await positionQuantity(page, TICKER);
  expect(held).toBeCloseTo(2.5, 6);

  const cashBefore = await readStat(page, "Cash");
  const notional = await fill(page, held as number, "sell");

  await expect(positionRow(page, TICKER)).toHaveCount(0);
  expect(await readStat(page, "Cash")).toBeCloseTo(cashBefore + notional, 2);
});
