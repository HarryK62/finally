import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PnlChart } from "./PnlChart";
import type { PortfolioResponse, Snapshot } from "@/lib/types";
import { position, renderWithTerminal, tick } from "@/test/harness";

const EMPTY_TEXT = "Portfolio value is snapshotted every 30s — building history…";

function portfolio(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    cash_balance: 10_000,
    positions: [],
    positions_value: 0,
    total_value: 10_000,
    total_cost_basis: 0,
    total_unrealized_pnl: 0,
    total_unrealized_pnl_percent: 0,
    ...overrides,
  };
}

/** Snapshots ending well before "now", so the live point is always appended. */
function snapshots(...values: number[]): Snapshot[] {
  const start = Date.now() - values.length * 30_000 - 60_000;
  return values.map((total_value, index) => ({
    total_value,
    recorded_at: new Date(start + index * 30_000).toISOString(),
  }));
}

function chartRoot(): Element | null {
  return document.querySelector(".recharts-responsive-container");
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 200,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 200,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PnlChart", () => {
  it("explains itself while history is still being built", () => {
    renderWithTerminal(<PnlChart />, { snapshots: [], portfolio: null });
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(chartRoot()).toBeNull();
  });

  it("still waits when a single snapshot exists and there is no portfolio yet", () => {
    renderWithTerminal(<PnlChart />, { snapshots: snapshots(10_000), portfolio: null });
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it("draws once one snapshot plus the live value make two points", () => {
    renderWithTerminal(<PnlChart />, {
      snapshots: snapshots(10_000),
      portfolio: portfolio(),
    });

    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    expect(chartRoot()).not.toBeNull();
  });

  it("reports the session change from the first snapshot to the live value", () => {
    renderWithTerminal(<PnlChart />, {
      snapshots: snapshots(10_000, 10_200),
      portfolio: portfolio({ total_value: 10_500, cash_balance: 10_500 }),
    });

    // 10,000 → 10,500 = +5%.
    expect(screen.getByText(/\+5\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });

  it("reports a decline with the down class", () => {
    renderWithTerminal(<PnlChart />, {
      snapshots: snapshots(10_000, 9_800),
      portfolio: portfolio({ total_value: 9_500, cash_balance: 9_500 }),
    });

    const accessory = screen.getByText(/-5\.00%/);
    expect(accessory).toHaveClass("text-down");
    expect(accessory).toHaveTextContent("▼");
  });

  it("pins the live re-priced value on the end rather than the stale REST total", () => {
    renderWithTerminal(<PnlChart />, {
      snapshots: snapshots(10_000),
      // REST says 10,000; the stream says AAPL is at 200, so it is really 11,000.
      portfolio: portfolio({
        cash_balance: 9_000,
        positions: [position("AAPL", 10, 100, 100)],
        positions_value: 1_000,
        total_value: 10_000,
      }),
      prices: { AAPL: tick("AAPL", 200) },
    });

    expect(screen.getByText(/\+10\.00%/)).toBeInTheDocument();
  });

  it("ignores snapshots with an unparseable timestamp", () => {
    renderWithTerminal(<PnlChart />, {
      snapshots: [
        { total_value: 10_000, recorded_at: "not a date" },
        ...snapshots(10_000),
      ],
      portfolio: portfolio({ total_value: 10_100, cash_balance: 10_100 }),
    });

    expect(screen.getByText(/\+1\.00%/)).toBeInTheDocument();
  });

  it("keeps its panel title", () => {
    renderWithTerminal(<PnlChart />, { snapshots: [], portfolio: null });
    expect(screen.getByRole("heading", { name: "Portfolio Value" })).toBeInTheDocument();
  });
});
