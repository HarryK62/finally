"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtQuantity } from "@/lib/format";
import type { TradeSide } from "@/lib/types";
import { usePrice, useTerminal } from "@/state/terminal";

/**
 * Market orders, instant fill, no confirmation dialog (PLAN §2). The only
 * feedback loop is this bar: the estimated notional before you commit, and the
 * fill or the backend's `detail` message after.
 */
export function TradeBar() {
  const { selected, trade } = useTerminal();
  const [ticker, setTicker] = useState(selected ?? "");
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState<TradeSide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState<string | null>(null);

  // Follow the chart selection, but never overwrite something being typed.
  // Adjusted during render rather than in an effect so the field is already
  // correct on the render that observes the new selection.
  const [seenSelected, setSeenSelected] = useState(selected);
  if (selected !== seenSelected) {
    setSeenSelected(selected);
    if (selected && ticker === "") setTicker(selected);
  }

  const symbol = ticker.trim().toUpperCase();
  const price = usePrice(symbol || null);
  const qty = Number.parseFloat(quantity);
  const validQty = Number.isFinite(qty) && qty > 0;
  const notional = validQty && price != null ? qty * price : null;

  async function submit(side: TradeSide) {
    setError(null);
    setFill(null);

    if (!symbol) {
      setError("Enter a ticker symbol");
      return;
    }
    if (!validQty) {
      setError("Quantity must be greater than zero");
      return;
    }

    setPending(side);
    try {
      const result = await trade(symbol, qty, side);
      const verb = result.trade.side === "buy" ? "Bought" : "Sold";
      setFill(
        `${verb} ${fmtQuantity(result.trade.quantity)} ${result.trade.ticker} @ $${fmtNumber(
          result.trade.price,
        )} · ${fmtCurrency(result.trade.total)}`,
      );
      setQuantity("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Trade failed");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-panel px-4"
    >
      <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-muted sm:block">
        Market
        <br />
        Order
      </span>

      <input
        value={ticker}
        onChange={(event) => setTicker(event.target.value.toUpperCase())}
        placeholder="SYMBOL"
        aria-label="Ticker"
        maxLength={8}
        className="numeric w-20 shrink-0 rounded-sm border border-border bg-terminal px-2 py-1.5 text-sm font-semibold uppercase text-ink placeholder:font-normal placeholder:text-muted focus:border-primary focus:outline-none xl:w-28"
      />

      <input
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        placeholder="QTY"
        aria-label="Quantity"
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        className="numeric w-20 shrink-0 rounded-sm border border-border bg-terminal px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none xl:w-28"
      />

      <div className="flex w-24 shrink-0 flex-col leading-none xl:w-40">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
          Last
        </span>
        <span className="numeric mt-1 text-sm text-ink">
          {price == null ? "—" : `$${fmtNumber(price)}`}
        </span>
      </div>

      <div className="flex w-28 shrink-0 flex-col leading-none xl:w-44">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
          Estimated
        </span>
        <span className="numeric mt-1 text-sm text-accent">
          {notional == null ? "—" : fmtCurrency(notional)}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit("buy")}
          disabled={busy}
          className="w-16 shrink-0 xl:w-24 rounded-sm bg-up px-4 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-terminal transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending === "buy" ? "…" : "Buy"}
        </button>
        <button
          type="button"
          onClick={() => void submit("sell")}
          disabled={busy}
          className="w-16 shrink-0 xl:w-24 rounded-sm bg-down px-4 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-terminal transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending === "sell" ? "…" : "Sell"}
        </button>
      </div>

      <div className="min-w-0 flex-1 truncate text-xs">
        {error ? (
          <span role="alert" className="text-down">
            {error}
          </span>
        ) : fill ? (
          <span role="status" className="text-up">
            {fill}
          </span>
        ) : null}
      </div>
    </form>
  );
}
