/**
 * PLAN.md §12 — "Portfolio visualization: heatmap renders with correct colors,
 * P&L chart has data points".
 *
 * The sign of a live P&L is not knowable in advance (the simulator is a random
 * walk), so the heatmap assertion is a *relation*: whatever percentage a cell
 * prints, its fill must have moved from the neutral midpoint toward the correct
 * hue, and by enough to be visible once the move is more than a rounding
 * artefact. Asserting a fixed colour would only test the simulator's mood.
 */

import { expect, test } from "@playwright/test";

import {
  chartPointCount,
  heatmapCell,
  heatmapPanel,
  openTerminal,
  panel,
  placeOrder,
  positionQuantity,
  positionRow,
  positionsPanel,
  readHeatCell,
  tradeFill,
} from "../support/terminal";

/** `heat.ts` neutral midpoint — the fill for a position that is exactly flat. */
const [NEUTRAL_R, NEUTRAL_G, NEUTRAL_B] = [43, 50, 60];

/**
 * The cell prints its P&L to 2 dp, so anything under half a basis point reads
 * as "0.00%" and its true sign is unknowable from the DOM. Below this the fill
 * is only required to sit *near* the neutral midpoint.
 */
const UNREADABLE = 0.005;

/**
 * Above this the two hues have separated far enough that "greener than red" is
 * a safe assertion. Between `UNREADABLE` and here the ramp is still correctly
 * signed but the channels can round to the same integer.
 */
const OBVIOUS = 0.1;

const HOLDINGS: Array<[string, number]> = [
  ["MSFT", 6],
  ["AMZN", 4],
];

test.describe.configure({ mode: "serial" });

test("opens the positions the visualisations need", async ({ page }) => {
  await openTerminal(page);

  for (const [ticker, quantity] of HOLDINGS) {
    if ((await positionQuantity(page, ticker)) != null) continue;
    await placeOrder(page, ticker, quantity, "buy");
    await expect(tradeFill(page)).toContainText(`Bought ${quantity} ${ticker}`);
    await expect(positionRow(page, ticker)).toHaveCount(1);
  }
});

test("the heatmap renders one sized cell per position, coloured by P&L", async ({ page }) => {
  await openTerminal(page);

  await expect(heatmapPanel(page)).not.toContainText("No open positions");

  // One cell per row of the positions table — no more, no fewer.
  const rows = await positionsPanel(page).locator("tbody tr").count();
  expect(rows).toBeGreaterThanOrEqual(HOLDINGS.length);
  await expect(heatmapPanel(page).getByRole("button")).toHaveCount(rows);

  for (const [ticker] of HOLDINGS) {
    await expect(heatmapCell(page, ticker)).toBeVisible();

    const { percent, rgb, width, height } = await readHeatCell(page, ticker);
    const [red, green, blue] = rgb;
    const where = `${ticker} at ${percent}% → rgb(${rgb.join(", ")})`;

    // Sized by portfolio weight — a zero-area cell means the treemap failed.
    expect(width, `${ticker} heat cell width`).toBeGreaterThan(0);
    expect(height, `${ticker} heat cell height`).toBeGreaterThan(0);

    if (Math.abs(percent) < UNREADABLE) {
      // The true sign is below display precision; only require a neutral fill.
      expect(Math.abs(red - NEUTRAL_R), where).toBeLessThanOrEqual(8);
      expect(Math.abs(green - NEUTRAL_G), where).toBeLessThanOrEqual(8);
      expect(Math.abs(blue - NEUTRAL_B), where).toBeLessThanOrEqual(8);
    } else if (percent > 0) {
      // The ramp is monotone: a gain only ever moves away from neutral toward
      // green, never the other way, however small the gain is.
      expect(green, where).toBeGreaterThanOrEqual(NEUTRAL_G);
      expect(red, where).toBeLessThanOrEqual(NEUTRAL_R);
      if (percent >= OBVIOUS) expect(green, where).toBeGreaterThan(red);
    } else {
      expect(red, where).toBeGreaterThanOrEqual(NEUTRAL_R);
      expect(green, where).toBeLessThanOrEqual(NEUTRAL_G);
      if (percent <= -OBVIOUS) expect(red, where).toBeGreaterThan(green);
    }
  }
});

test("selecting a heatmap cell drives the main chart", async ({ page }) => {
  await openTerminal(page);

  await heatmapCell(page, "AMZN").click();
  await expect(panel(page, "AMZN · Session")).toBeVisible();
});

test("the P&L chart plots the portfolio value history", async ({ page }) => {
  await openTerminal(page);

  const pnl = panel(page, "Portfolio Value");
  await expect(pnl).not.toContainText("building history");
  await expect(pnl.locator("svg.recharts-surface")).toBeVisible();

  expect(await chartPointCount(page, "Portfolio Value")).toBeGreaterThanOrEqual(2);
});
