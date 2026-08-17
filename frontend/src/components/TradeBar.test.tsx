import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TradeBar } from "./TradeBar";
import { ApiError } from "@/lib/api";
import type { TradeResponse, TradeSide } from "@/lib/types";
import { position, renderWithTerminal, tick, watched } from "@/test/harness";

function tradeResponse(
  ticker: string,
  quantity: number,
  side: TradeSide,
  price: number,
): TradeResponse {
  return {
    trade: {
      id: "trade-1",
      ticker,
      side,
      quantity,
      price,
      total: quantity * price,
      executed_at: "2026-08-17T14:00:00.000Z",
    },
    cash_balance: 10_000 - quantity * price,
    position: position(ticker, quantity, price, price),
    total_value: 10_000,
  };
}

/** The value under a caption in the read-only part of the bar. */
function readout(label: string): HTMLElement {
  const caption = screen.getByText(label);
  const value = caption.nextElementSibling;
  if (!value) throw new Error(`no readout for ${label}`);
  return value as HTMLElement;
}

const symbolInput = () => screen.getByLabelText("Ticker");
const qtyInput = () => screen.getByLabelText("Quantity");
// The bar renders exactly two buttons, and their labels change to "…" while an
// order is pending — so address them by position, not by text.
const buy = () => screen.getAllByRole("button")[0];
const sell = () => screen.getAllByRole("button")[1];

describe("TradeBar", () => {
  it("starts blank with dashes rather than NaN", () => {
    renderWithTerminal(<TradeBar />, {});
    expect(symbolInput()).toHaveValue("");
    expect(readout("Last")).toHaveTextContent("—");
    expect(readout("Estimated")).toHaveTextContent("—");
  });

  it("prefills the ticker from the chart selection", () => {
    renderWithTerminal(<TradeBar />, {
      selected: "NVDA",
      prices: { NVDA: tick("NVDA", 900) },
    });
    expect(symbolInput()).toHaveValue("NVDA");
    expect(readout("Last")).toHaveTextContent("$900.00");
  });

  it("does not overwrite a ticker the user is typing", async () => {
    const user = userEvent.setup();
    const { update } = renderWithTerminal(<TradeBar />, { selected: null });

    await user.type(symbolInput(), "tsla");
    update({ selected: "NVDA" });

    expect(symbolInput()).toHaveValue("TSLA");
  });

  it("prices from the watchlist when no tick has streamed yet", async () => {
    const user = userEvent.setup();
    renderWithTerminal(<TradeBar />, { watchlist: [watched("META", 505.5)] });

    await user.type(symbolInput(), "meta");
    expect(readout("Last")).toHaveTextContent("$505.50");
  });

  it("computes the estimated notional as quantity × price", async () => {
    const user = userEvent.setup();
    renderWithTerminal(<TradeBar />, { prices: { AAPL: tick("AAPL", 190.5) } });

    await user.type(symbolInput(), "AAPL");
    await user.type(qtyInput(), "3");

    expect(readout("Estimated")).toHaveTextContent("$571.50");
  });

  it("leaves the estimate blank for an unpriced or invalid quantity", async () => {
    const user = userEvent.setup();
    renderWithTerminal(<TradeBar />, { prices: { AAPL: tick("AAPL", 190.5) } });

    await user.type(symbolInput(), "AAPL");
    expect(readout("Estimated")).toHaveTextContent("—");

    await user.type(qtyInput(), "0");
    expect(readout("Estimated")).toHaveTextContent("—");
  });

  it("rejects a missing ticker before calling the backend", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<TradeBar />, {});

    await user.type(qtyInput(), "5");
    await user.click(buy());

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a ticker symbol");
    expect(state.trade).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity before calling the backend", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<TradeBar />, {});

    await user.type(symbolInput(), "AAPL");
    await user.click(buy());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Quantity must be greater than zero",
    );

    await user.type(qtyInput(), "0");
    await user.click(sell());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Quantity must be greater than zero",
    );

    expect(state.trade).not.toHaveBeenCalled();
  });

  it("submits a buy and confirms the fill", async () => {
    const user = userEvent.setup();
    const trade = vi.fn().mockResolvedValue(tradeResponse("AAPL", 2, "buy", 190.25));
    renderWithTerminal(<TradeBar />, { trade, prices: { AAPL: tick("AAPL", 190.25) } });

    await user.type(symbolInput(), "aapl");
    await user.type(qtyInput(), "2");
    await user.click(buy());

    expect(trade).toHaveBeenCalledWith("AAPL", 2, "buy");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Bought 2 AAPL @ $190.25 · $380.50",
    );
    // Quantity clears so a fat finger cannot repeat the order.
    expect(qtyInput()).toHaveValue(null);
  });

  it("submits a sell, including a fractional quantity", async () => {
    const user = userEvent.setup();
    const trade = vi.fn().mockResolvedValue(tradeResponse("TSLA", 0.5, "sell", 240));
    renderWithTerminal(<TradeBar />, { trade });

    await user.type(symbolInput(), "TSLA");
    await user.type(qtyInput(), "0.5");
    await user.click(sell());

    expect(trade).toHaveBeenCalledWith("TSLA", 0.5, "sell");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sold 0.5 TSLA @ $240.00 · $120.00",
    );
  });

  it("surfaces the backend's rejection and keeps the quantity", async () => {
    const user = userEvent.setup();
    const trade = vi.fn().mockRejectedValue(new ApiError("Insufficient cash", 400));
    renderWithTerminal(<TradeBar />, { trade });

    await user.type(symbolInput(), "AAPL");
    await user.type(qtyInput(), "1000");
    await user.click(buy());

    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient cash");
    expect(qtyInput()).toHaveValue(1000);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("locks both buttons while an order is in flight", async () => {
    const user = userEvent.setup();
    let settle: (value: TradeResponse) => void = () => undefined;
    const trade = vi.fn(
      () =>
        new Promise<TradeResponse>((resolve) => {
          settle = resolve;
        }),
    );
    renderWithTerminal(<TradeBar />, { trade });

    await user.type(symbolInput(), "AAPL");
    await user.type(qtyInput(), "1");
    await user.click(buy());

    expect(buy()).toBeDisabled();
    expect(sell()).toBeDisabled();
    expect(buy()).toHaveTextContent("…");

    settle(tradeResponse("AAPL", 1, "buy", 190));
    await waitFor(() => expect(buy()).toBeEnabled());
    expect(buy()).toHaveTextContent("Buy");
  });
});
