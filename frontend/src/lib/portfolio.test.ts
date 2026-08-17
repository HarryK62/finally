import { describe, expect, it } from "vitest";

import { computeLivePortfolio } from "./portfolio";
import type { PortfolioResponse, PriceMap } from "./types";
import { position, tick } from "@/test/harness";

function portfolio(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    cash_balance: 5_000,
    positions: [],
    positions_value: 0,
    total_value: 5_000,
    total_cost_basis: 0,
    total_unrealized_pnl: 0,
    total_unrealized_pnl_percent: 0,
    ...overrides,
  };
}

const prices = (map: Record<string, number>): PriceMap =>
  Object.fromEntries(Object.entries(map).map(([ticker, price]) => [ticker, tick(ticker, price)]));

describe("computeLivePortfolio", () => {
  it("returns zeroed totals before the first portfolio fetch", () => {
    const live = computeLivePortfolio(null, prices({ AAPL: 190 }));
    expect(live).toEqual({
      cashBalance: 0,
      positions: [],
      positionsValue: 0,
      totalValue: 0,
      totalCostBasis: 0,
      totalUnrealizedPnl: 0,
      totalUnrealizedPnlPercent: 0,
    });
  });

  it("re-prices positions against the live stream", () => {
    const live = computeLivePortfolio(
      portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices({ AAPL: 190 }),
    );

    const [aapl] = live.positions;
    expect(aapl.current_price).toBe(190);
    expect(aapl.market_value).toBe(1_900);
    expect(aapl.cost_basis).toBe(1_800);
    expect(aapl.unrealized_pnl).toBe(100);
    expect(aapl.unrealized_pnl_percent).toBeCloseTo(5.5556, 4);
    expect(live.totalValue).toBe(6_900);
    expect(live.totalUnrealizedPnl).toBe(100);
    expect(live.totalUnrealizedPnlPercent).toBeCloseTo(5.5556, 4);
  });

  it("falls back to the last REST price when no tick has arrived", () => {
    const live = computeLivePortfolio(
      portfolio({ positions: [position("AAPL", 10, 180, 185)] }),
      {},
    );
    expect(live.positions[0].current_price).toBe(185);
    expect(live.positions[0].unrealized_pnl).toBe(50);
  });

  it("falls back to avg_cost so an unpriced position reads flat, not NaN", () => {
    // The contract types `current_price` as a number, but a ticker with no cached
    // price serialises as JSON null; that is the case this fallback exists for.
    const held = { ...position("AAPL", 10, 180, 180), current_price: null as unknown as number };
    const live = computeLivePortfolio(portfolio({ positions: [held] }), {});

    expect(live.positions[0].current_price).toBe(180);
    expect(live.positions[0].unrealized_pnl).toBe(0);
    expect(live.positions[0].unrealized_pnl_percent).toBe(0);
  });

  it("ignores a non-finite streamed price", () => {
    const broken: PriceMap = { AAPL: { ...tick("AAPL", 190), price: Number.NaN } };
    const live = computeLivePortfolio(
      portfolio({ positions: [position("AAPL", 10, 180, 185)] }),
      broken,
    );
    expect(live.positions[0].current_price).toBe(185);
  });

  it("recomputes weights from live market value and sorts by size", () => {
    const live = computeLivePortfolio(
      portfolio({
        positions: [position("AAPL", 10, 100, 100), position("NVDA", 10, 300, 300)],
      }),
      prices({ AAPL: 100, NVDA: 300 }),
    );

    expect(live.positions.map((item) => item.ticker)).toEqual(["NVDA", "AAPL"]);
    expect(live.positions[0].weight).toBeCloseTo(0.75, 10);
    expect(live.positions[1].weight).toBeCloseTo(0.25, 10);
    expect(live.positions.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 10);
  });

  it("handles a loss without sign confusion", () => {
    const live = computeLivePortfolio(
      portfolio({ cash_balance: 0, positions: [position("TSLA", 4, 250, 250)] }),
      prices({ TSLA: 200 }),
    );

    expect(live.totalUnrealizedPnl).toBe(-200);
    expect(live.totalUnrealizedPnlPercent).toBe(-20);
    expect(live.totalValue).toBe(800);
  });

  it("keeps percentages at zero when the cost basis is zero", () => {
    const live = computeLivePortfolio(
      portfolio({ positions: [position("AAPL", 10, 0, 0)] }),
      prices({ AAPL: 0 }),
    );
    expect(live.positionsValue).toBe(0);
    expect(live.positions[0].weight).toBe(0);
    expect(live.totalUnrealizedPnlPercent).toBe(0);
  });

  it("carries cash through when there are no positions", () => {
    const live = computeLivePortfolio(portfolio({ cash_balance: 10_000 }), {});
    expect(live.totalValue).toBe(10_000);
    expect(live.positions).toEqual([]);
  });

  it("supports fractional share quantities", () => {
    const live = computeLivePortfolio(
      portfolio({ cash_balance: 0, positions: [position("AAPL", 0.5, 200, 200)] }),
      prices({ AAPL: 210 }),
    );
    expect(live.positionsValue).toBe(105);
    expect(live.totalUnrealizedPnl).toBe(5);
  });
});
