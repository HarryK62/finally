/**
 * PLAN.md §12 — "AI chat (mocked): send a message, receive a response, trade
 * execution appears inline".
 *
 * The suite runs with `LLM_MOCK=true`, so every reply is the deterministic
 * keyword-driven mock from CONTRACTS.md §7 and no request ever leaves the
 * machine. The `[mock]` prefix is asserted explicitly: if it is missing, the
 * backend reached a real model and the run is invalid.
 */

import { expect, test } from "@playwright/test";

import {
  chatActionChips,
  chatPanel,
  mockReplies,
  openTerminal,
  positionQuantity,
  positionRow,
  readStat,
  sendChat,
  watchlistPrice,
  watchlistSelect,
} from "../support/terminal";

test.describe.configure({ mode: "serial" });

test("answers a portfolio question without taking any action", async ({ page }) => {
  await openTerminal(page);

  await sendChat(page, "How is my portfolio doing?");

  const reply = mockReplies(page).last();
  await expect(reply).toBeVisible();
  await expect(reply).toContainText(/^\[mock\] You have \$[\d,]+\.\d{2} in cash/);
  await expect(reply).toContainText(/\d+ open position/);
  await expect(chatActionChips(page)).toHaveCount(0);
});

test("executes a trade and confirms it inline", async ({ page }) => {
  await openTerminal(page);

  const cashBefore = await readStat(page, "Cash");
  const heldBefore = (await positionQuantity(page, "NVDA")) ?? 0;

  await sendChat(page, "Buy 5 NVDA");

  await expect(mockReplies(page).last()).toContainText("[mock] Buying 5 NVDA");

  const chip = chatActionChips(page).last();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/BUY\s+5\s+NVDA\s+@\s+\$[\d,]+\.\d{2}/);
  await expect(chip).toContainText(/Bought 5 NVDA @ \$[\d,]+\.\d{2}/);

  // The panel refetches after an executed action, so the terminal must agree.
  await expect(positionRow(page, "NVDA")).toHaveCount(1);
  expect(await positionQuantity(page, "NVDA")).toBeCloseTo(heldBefore + 5, 6);
  expect(await readStat(page, "Cash")).toBeLessThan(cashBefore);
});

test("sells through the assistant and returns the cash", async ({ page }) => {
  await openTerminal(page);

  const cashBefore = await readStat(page, "Cash");
  const heldBefore = (await positionQuantity(page, "NVDA")) ?? 0;
  expect(heldBefore).toBeGreaterThanOrEqual(5);

  await sendChat(page, "Sell 5 NVDA");

  await expect(mockReplies(page).last()).toContainText("[mock] Selling 5 NVDA");
  await expect(chatActionChips(page).last()).toContainText(/Sold 5 NVDA @ \$[\d,]+\.\d{2}/);

  // A sell down to zero deletes the position row, so a missing row reads as 0.
  expect((await positionQuantity(page, "NVDA")) ?? 0).toBeCloseTo(heldBefore - 5, 6);
  expect(await readStat(page, "Cash")).toBeGreaterThan(cashBefore);
});

test("manages the watchlist through the assistant", async ({ page }) => {
  await openTerminal(page);

  await sendChat(page, "Add PYPL");
  await expect(mockReplies(page).last()).toContainText("[mock] Adding PYPL to your watchlist");
  await expect(chatActionChips(page).last()).toContainText("ADD PYPL");
  await expect(watchlistSelect(page, "PYPL")).toBeVisible();
  await expect(watchlistPrice(page, "PYPL")).not.toHaveText("—");

  await sendChat(page, "Remove PYPL");
  await expect(mockReplies(page).last()).toContainText("[mock] Removing PYPL from your watchlist");
  await expect(chatActionChips(page).last()).toContainText("REMOVE PYPL");
  await expect(watchlistSelect(page, "PYPL")).toHaveCount(0);
});

test("shows a rejected action as a failed chip rather than an error", async ({ page }) => {
  await openTerminal(page);

  // ZZZZ is not watched, so the price cache has nothing to fill against.
  await sendChat(page, "Buy 1 ZZZZ");

  const reply = mockReplies(page).last();
  await expect(reply).toContainText("[mock] Buying 1 ZZZZ");
  await expect(reply).toContainText(/could not complete that action/i);

  const chip = chatActionChips(page).last();
  await expect(chip).toContainText("BUY 1 ZZZZ");
  await expect(chip).toContainText("No price available for ZZZZ");
  await expect(positionRow(page, "ZZZZ")).toHaveCount(0);
});

test("replays the transcript from the server on reload", async ({ page }) => {
  await openTerminal(page);

  // Everything above was persisted to chat_messages; a fresh load must show it.
  await expect(chatPanel(page)).not.toContainText("AI assistant is not connected yet");
  await expect(mockReplies(page).first()).toContainText("[mock]");
  expect(await mockReplies(page).count()).toBeGreaterThanOrEqual(5);
});
