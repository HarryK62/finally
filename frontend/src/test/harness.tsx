import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";

import { TerminalContext, type TerminalState } from "@/state/terminal";
import type { Position, PriceTick, WatchlistItem } from "@/lib/types";

/** Mount a panel against a hand-built terminal state instead of live sockets. */
export function renderWithTerminal(
  ui: ReactElement,
  overrides: Partial<TerminalState> = {},
): RenderResult & {
  state: TerminalState;
  /** Push new context values into the *same* mounted tree, as a live tick would. */
  update: (next: Partial<TerminalState>) => void;
} {
  const state: TerminalState = {
    prices: {},
    buffers: {},
    status: "open",
    health: null,
    portfolio: null,
    watchlist: [],
    snapshots: [],
    loading: false,
    error: null,
    selected: null,
    select: vi.fn(),
    trade: vi.fn(),
    addTicker: vi.fn(),
    removeTicker: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };

  let current = state;
  const wrap = (value: TerminalState) => (
    <TerminalContext.Provider value={value}>{ui}</TerminalContext.Provider>
  );

  const result = render(wrap(current));

  const update = (next: Partial<TerminalState>) => {
    current = { ...current, ...next };
    result.rerender(wrap(current));
  };

  return { ...result, state, update };
}

export function tick(ticker: string, price: number, previous = price): PriceTick {
  const change = price - previous;
  return {
    ticker,
    price,
    previous_price: previous,
    timestamp: 1_755_439_402.48,
    change,
    change_percent: previous === 0 ? 0 : (change / previous) * 100,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

export function watched(ticker: string, price: number | null = null): WatchlistItem {
  return {
    ticker,
    added_at: "2026-08-17T14:00:00.000Z",
    price,
    previous_price: price,
    change: 0,
    change_percent: 0,
    direction: "flat",
  };
}

export function position(
  ticker: string,
  quantity: number,
  avgCost: number,
  currentPrice: number,
): Position {
  const marketValue = quantity * currentPrice;
  const costBasis = quantity * avgCost;
  return {
    ticker,
    quantity,
    avg_cost: avgCost,
    current_price: currentPrice,
    market_value: marketValue,
    cost_basis: costBasis,
    unrealized_pnl: marketValue - costBasis,
    unrealized_pnl_percent: costBasis === 0 ? 0 : ((marketValue - costBasis) / costBasis) * 100,
    weight: 1,
  };
}
