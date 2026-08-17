/**
 * Re-price the portfolio from the SSE stream.
 *
 * `GET /api/portfolio` is only polled every 5s, but prices tick twice a second.
 * Rather than hammer the endpoint, we take the authoritative quantities and
 * cost basis from the last poll and recompute the derived values against live
 * prices, using exactly the formulas in contract §6 so the numbers agree with
 * the server between polls.
 */

import type { PortfolioResponse, Position, PriceMap } from "./types";

export interface LivePortfolio {
  cashBalance: number;
  positions: Position[];
  positionsValue: number;
  totalValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPercent: number;
}

const EMPTY: LivePortfolio = {
  cashBalance: 0,
  positions: [],
  positionsValue: 0,
  totalValue: 0,
  totalCostBasis: 0,
  totalUnrealizedPnl: 0,
  totalUnrealizedPnlPercent: 0,
};

export function computeLivePortfolio(
  portfolio: PortfolioResponse | null,
  prices: PriceMap,
): LivePortfolio {
  if (!portfolio) return EMPTY;

  const repriced = portfolio.positions.map((position) => {
    const tick = prices[position.ticker];
    // Contract §6: with no cached price, fall back to avg_cost so P&L reads 0.
    const currentPrice =
      tick && Number.isFinite(tick.price)
        ? tick.price
        : (position.current_price ?? position.avg_cost);

    const marketValue = position.quantity * currentPrice;
    const costBasis = position.quantity * position.avg_cost;
    const unrealizedPnl = marketValue - costBasis;

    return {
      ...position,
      current_price: currentPrice,
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_pnl: unrealizedPnl,
      unrealized_pnl_percent: costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100,
    };
  });

  const positionsValue = repriced.reduce((sum, position) => sum + position.market_value, 0);
  const totalCostBasis = repriced.reduce((sum, position) => sum + position.cost_basis, 0);
  const totalUnrealizedPnl = positionsValue - totalCostBasis;

  const positions = repriced
    .map((position) => ({
      ...position,
      weight: positionsValue === 0 ? 0 : position.market_value / positionsValue,
    }))
    .sort((a, b) => b.market_value - a.market_value);

  return {
    cashBalance: portfolio.cash_balance,
    positions,
    positionsValue,
    totalValue: portfolio.cash_balance + positionsValue,
    totalCostBasis,
    totalUnrealizedPnl,
    totalUnrealizedPnlPercent:
      totalCostBasis === 0 ? 0 : (totalUnrealizedPnl / totalCostBasis) * 100,
  };
}
