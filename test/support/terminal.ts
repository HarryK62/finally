/**
 * Locators and small readers for the FinAlly terminal.
 *
 * Every locator here is built from something the user can perceive — a panel
 * caption, an accessible name, a `data-testid` the frontend already ships —
 * rather than a Tailwind class, so a restyle does not break the suite.
 *
 * Nothing in this file sleeps. Prices move every ~500ms and the portfolio
 * re-polls every 5s, so waiting is always either a web-first assertion or an
 * `expect.poll` on a value that must *change*.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/** The seeded watchlist, in seed order (CONTRACTS.md §4). */
export const DEFAULT_TICKERS = [
  "AAPL",
  "GOOGL",
  "MSFT",
  "AMZN",
  "TSLA",
  "NVDA",
  "META",
  "JPM",
  "V",
  "NFLX",
] as const;

export type TradeSide = "buy" | "sell";

// --- Structure ---

/** A workstation panel, addressed by its caption ("Positions", "Watchlist", …). */
export function panel(page: Page, title: string): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  });
}

/** The value span of a header stat ("Portfolio Value", "Cash", "Return", …). */
export function headerStat(page: Page, label: string): Locator {
  return page.locator(
    `xpath=//header//span[normalize-space(.)='${label}']/following-sibling::span[1]`,
  );
}

export function connectionStatus(page: Page): Locator {
  return page.getByTestId("connection-status");
}

// --- Numbers ---

/**
 * `"$1,234.50"` → `1234.5`, `"-$12.30"` → `-12.3`, `"▲ +2.63%"` → `2.63`,
 * `"—"` → `null`.
 */
export function parseMoney(text: string | null | undefined): number | null {
  if (text == null) return null;
  const cleaned = text.replace(/[\s,$%▲▼·+]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Read a header stat as a number, failing the test if it is still a dash. */
export async function readStat(page: Page, label: string): Promise<number> {
  const raw = await headerStat(page, label).textContent();
  const value = parseMoney(raw);
  expect(value, `header stat "${label}" should be a number, got ${JSON.stringify(raw)}`).not.toBeNull();
  return value as number;
}

// --- Page lifecycle ---

/** Open the terminal and wait for the first portfolio load to land. */
export async function openTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await expect(headerStat(page, "Cash")).not.toHaveText("—");
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
}

// --- Watchlist ---

export function watchlistPanel(page: Page): Locator {
  return panel(page, "Watchlist");
}

export function watchlistPrice(page: Page, ticker: string): Locator {
  return page.getByTestId(`price-${ticker}`);
}

export function watchlistSelect(page: Page, ticker: string): Locator {
  return page.getByRole("button", { name: `Select ${ticker}`, exact: true });
}

export function watchlistRemove(page: Page, ticker: string): Locator {
  return page.getByRole("button", { name: `Remove ${ticker} from watchlist`, exact: true });
}

/** Every watchlist price cell — count equals the number of watched symbols. */
export function watchlistPrices(page: Page): Locator {
  return page.getByTestId(/^price-/);
}

export async function addWatchlistTicker(page: Page, ticker: string): Promise<void> {
  const list = watchlistPanel(page);
  await list.getByLabel("Add ticker to watchlist").fill(ticker);
  await list.getByRole("button", { name: "Add", exact: true }).click();
}

/** The inline error under the watchlist's add form. */
export function watchlistError(page: Page): Locator {
  return watchlistPanel(page).getByRole("alert");
}

/**
 * Assert the price stream is live by requiring the rendered prices to *change*.
 *
 * Never asserts a specific value: the simulator is a random walk. Comparing the
 * whole row of prices rather than one ticker keeps this from flaking on a
 * symbol that happens to round to the same cents twice in a row.
 */
export async function expectPricesToMove(page: Page): Promise<void> {
  const snapshot = async () => (await watchlistPrices(page).allTextContents()).join("|");
  const before = await snapshot();
  await expect
    .poll(snapshot, {
      message: "watchlist prices should change while the SSE stream is connected",
      timeout: 20_000,
      intervals: [250, 250, 500, 500, 1000],
    })
    .not.toBe(before);
}

// --- Positions ---

export function positionsPanel(page: Page): Locator {
  return panel(page, "Positions");
}

export function positionRow(page: Page, ticker: string): Locator {
  return positionsPanel(page)
    .locator("tbody tr")
    .filter({ has: page.getByRole("cell", { name: ticker, exact: true }) });
}

/** Quantity held, read from the positions table; `null` when there is no row. */
export async function positionQuantity(page: Page, ticker: string): Promise<number | null> {
  const row = positionRow(page, ticker);
  if ((await row.count()) === 0) return null;
  return parseMoney(await row.locator("td").nth(1).textContent());
}

// --- Trade bar ---

export function tradeBar(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByLabel("Ticker", { exact: true }) });
}

/** Fill the market-order bar and submit. Does not wait for the fill. */
export async function placeOrder(
  page: Page,
  ticker: string,
  quantity: number,
  side: TradeSide,
): Promise<void> {
  const bar = tradeBar(page);
  await bar.getByLabel("Ticker", { exact: true }).fill(ticker);
  await bar.getByLabel("Quantity", { exact: true }).fill(String(quantity));
  await bar.getByRole("button", { name: side === "buy" ? "Buy" : "Sell", exact: true }).click();
}

/** The green "Bought 4 NVDA @ $…" confirmation. */
export function tradeFill(page: Page): Locator {
  return tradeBar(page).getByRole("status");
}

/** The red rejection message ("Insufficient cash: …"). */
export function tradeError(page: Page): Locator {
  return tradeBar(page).getByRole("alert");
}

// --- Chat ---

export function chatPanel(page: Page): Locator {
  return page.locator("aside").filter({
    has: page.getByRole("heading", { level: 2, name: "FinAlly Assistant", exact: true }),
  });
}

export async function sendChat(page: Page, message: string): Promise<void> {
  const chat = chatPanel(page);
  await chat.getByLabel("Message the AI assistant").fill(message);
  await chat.getByRole("button", { name: "Send", exact: true }).click();
}

/** Every assistant reply rendered so far (mock replies all start with `[mock]`). */
export function mockReplies(page: Page): Locator {
  return chatPanel(page).getByText(/^\[mock\]/);
}

/** The inline trade / watchlist confirmation chips under an assistant reply. */
export function chatActionChips(page: Page): Locator {
  return chatPanel(page).locator("li");
}

// --- Heatmap ---

export function heatmapPanel(page: Page): Locator {
  return panel(page, "Allocation Heatmap");
}

export function heatmapCell(page: Page, ticker: string): Locator {
  return heatmapPanel(page).getByRole("button", { name: new RegExp(`^${ticker},`) });
}

/**
 * The label and fill of one heat cell, read in a single evaluation so the
 * percentage and the color can never come from different renders.
 */
export async function readHeatCell(
  page: Page,
  ticker: string,
): Promise<{ percent: number; rgb: [number, number, number]; width: number; height: number }> {
  const cell = heatmapCell(page, ticker);
  await expect(cell).toBeVisible();

  const raw = await cell.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      label: el.getAttribute("aria-label") ?? "",
      background: getComputedStyle(el).backgroundColor,
      width: rect.width,
      height: rect.height,
    };
  });

  const match = raw.label.match(/(-?[\d,.]+)%/);
  expect(match, `heat cell for ${ticker} should state its P&L percent, got "${raw.label}"`).not.toBeNull();
  const percent = Number.parseFloat((match as RegExpMatchArray)[1].replace(/,/g, ""));

  const channels = raw.background.match(/\d+/g) ?? [];
  expect(channels.length, `unparseable background "${raw.background}"`).toBeGreaterThanOrEqual(3);

  return {
    percent,
    rgb: [Number(channels[0]), Number(channels[1]), Number(channels[2])],
    width: raw.width,
    height: raw.height,
  };
}

// --- Charts ---

/**
 * Number of plotted points in an SVG path's `d`, counting the initial `M` plus
 * every following segment command. Recharts renders a monotone `Area` as one
 * `M` and one `C` per subsequent point.
 */
export function countPathPoints(d: string): number {
  const commands = d.match(/[MLCQSTAmlcqsta]/g);
  return commands ? commands.length : 0;
}

/** The longest data path inside a panel's chart, and how many points it has. */
export async function chartPointCount(page: Page, panelTitle: string): Promise<number> {
  const paths = panel(page, panelTitle).locator("svg path[d]");
  await expect(paths.first()).toBeAttached();

  const ds = await paths.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("d") ?? ""),
  );
  return Math.max(0, ...ds.map(countPathPoints));
}
