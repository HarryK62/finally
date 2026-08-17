/**
 * PLAN.md §12 — "SSE resilience: disconnect and verify reconnection".
 *
 * The disconnect is forced at the browser's network layer: once the stream is
 * established and quoting, every request to `/api/stream/prices` is failed with
 * a connection reset, which is exactly what a client sees when the backend goes
 * away. `EventSource` treats a reset as transient and retries on the server's
 * `retry: 1000` directive, so the test can assert three things that matter:
 * the terminal stops claiming to be LIVE, the client keeps trying unattended,
 * and it comes back on its own once the endpoint answers again — with no user
 * action and no reload.
 *
 * Known gap: Chromium's `context.setOffline()` does not tear down an already
 * established HTTP stream, and Playwright cannot fail a response mid-body, so
 * the established connection is severed by re-navigating with the block already
 * in place. A server-side mid-stream drop (a backend restart) is not covered.
 */

import { expect, test } from "@playwright/test";

import {
  connectionStatus,
  expectPricesToMove,
  headerStat,
  openTerminal,
} from "../support/terminal";

const STREAM = "**/api/stream/prices";

test.describe.configure({ mode: "serial" });

test("reconnects on its own after the price stream is cut", async ({ page }) => {
  await openTerminal(page);
  await expectPricesToMove(page);
  await expect(connectionStatus(page)).toContainText("LIVE");

  let attempts = 0;
  await page.route(STREAM, (route) => {
    attempts += 1;
    void route.abort("connectionreset");
  });

  // Severs the live stream and makes every retry fail from here on.
  await page.reload();

  await expect(connectionStatus(page)).not.toHaveAttribute("data-status", "open");
  await expect(connectionStatus(page)).not.toContainText("LIVE");

  // Unattended retries: nothing in the test clicks anything to cause these.
  await expect
    .poll(() => attempts, {
      message: "EventSource should keep retrying the dropped stream",
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(3);

  await page.unroute(STREAM);

  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
  await expect(connectionStatus(page)).toContainText("LIVE");
  await expectPricesToMove(page);
});

test("the rest of the terminal keeps working while the stream is down", async ({ page }) => {
  await openTerminal(page);

  await page.route(STREAM, (route) => void route.abort("connectionreset"));
  await page.reload();
  await expect(connectionStatus(page)).not.toHaveAttribute("data-status", "open");

  // Prices come from SSE, but balances come from REST — the panels must still
  // render rather than collapse into the "cannot reach the server" banner.
  // (Not `getByRole("alert")`: Recharts renders its own live region.)
  await expect(page.getByText(/is the backend running on port/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Watchlist" })).toBeVisible();
  await expect(headerStat(page, "Cash")).not.toHaveText("—");

  await page.unroute(STREAM);
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
});

test("survives a full page reload without losing the feed", async ({ page }) => {
  await openTerminal(page);
  await page.reload();
  await expect(connectionStatus(page)).toHaveAttribute("data-status", "open");
  await expectPricesToMove(page);
});
