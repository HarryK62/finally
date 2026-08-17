"use client";

import { useMemo } from "react";

import { Panel, PanelEmpty } from "@/components/Panel";
import { useElementSize } from "@/hooks/useElementSize";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { heatFill, heatStroke } from "@/lib/heat";
import { computeLivePortfolio } from "@/lib/portfolio";
import { squarify } from "@/lib/treemap";
import { useTerminal } from "@/state/terminal";

/** Gutter between cells, in px — the surface showing through separates fills. */
const GAP = 2;

export function PortfolioHeatmap() {
  const { portfolio, prices, selected, select } = useTerminal();
  const { ref, size } = useElementSize<HTMLDivElement>();

  const live = useMemo(() => computeLivePortfolio(portfolio, prices), [portfolio, prices]);

  const cells = useMemo(() => {
    if (size.width <= 0 || size.height <= 0) return [];

    const rects = squarify(
      live.positions.map((position) => ({ key: position.ticker, value: position.weight })),
      size.width,
      size.height,
    );
    const byTicker = new Map(live.positions.map((position) => [position.ticker, position]));

    return rects.flatMap((rect) => {
      const position = byTicker.get(rect.key);
      return position ? [{ rect, position }] : [];
    });
  }, [live.positions, size.width, size.height]);

  const hasPositions = live.positions.length > 0 && live.positionsValue > 0;

  return (
    <Panel
      title="Allocation Heatmap"
      accessory={
        hasPositions ? (
          <span className="numeric text-[10px] text-muted">
            {live.positions.length} positions · {fmtCurrency(live.positionsValue)}
          </span>
        ) : null
      }
      bodyClassName="p-2"
    >
      <div ref={ref} className="relative h-full w-full">
        {!hasPositions ? (
          <PanelEmpty>No open positions. Buy something to populate the map.</PanelEmpty>
        ) : (
          cells.map(({ rect, position }) => {
            const width = Math.max(rect.w - GAP, 0);
            const height = Math.max(rect.h - GAP, 0);
            // Below this a label is unreadable and would just overflow the cell.
            const showTicker = width >= 40 && height >= 22;
            const showPercent = width >= 52 && height >= 34;
            const showValue = width >= 74 && height >= 52;

            return (
              <button
                key={rect.key}
                type="button"
                onClick={() => select(position.ticker)}
                title={`${position.ticker} — ${fmtCurrency(position.market_value)}, ${fmtPercent(
                  position.unrealized_pnl_percent,
                )} unrealized`}
                aria-label={`${position.ticker}, ${fmtPercent(
                  position.unrealized_pnl_percent,
                )} unrealized profit and loss`}
                className="absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] transition-[filter] hover:brightness-125"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width,
                  height,
                  backgroundColor: heatFill(position.unrealized_pnl_percent),
                  boxShadow:
                    selected === position.ticker
                      ? "inset 0 0 0 1.5px #ecad0a"
                      : `inset 0 0 0 1px ${heatStroke(position.unrealized_pnl_percent)}`,
                }}
              >
                {showTicker ? (
                  <span className="numeric text-[11px] font-bold leading-tight text-ink">
                    {position.ticker}
                  </span>
                ) : null}
                {showPercent ? (
                  <span className="numeric text-[10px] leading-tight text-ink/90">
                    {fmtPercent(position.unrealized_pnl_percent)}
                  </span>
                ) : null}
                {showValue ? (
                  <span className="numeric text-[9px] leading-tight text-ink/60">
                    {fmtCurrency(position.market_value)}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </Panel>
  );
}
