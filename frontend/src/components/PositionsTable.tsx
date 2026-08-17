"use client";

import { memo, useMemo } from "react";

import { Panel, PanelEmpty } from "@/components/Panel";
import { useFlash } from "@/hooks/useFlash";
import {
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  fmtQuantity,
  fmtSignedCurrency,
  signClass,
  signGlyph,
} from "@/lib/format";
import { computeLivePortfolio } from "@/lib/portfolio";
import type { Position } from "@/lib/types";
import { useTerminal } from "@/state/terminal";

const HEADERS = [
  "Symbol",
  "Qty",
  "Avg Cost",
  "Last",
  "Mkt Value",
  "Unreal. P&L",
  "P&L %",
] as const;

const PositionRow = memo(function PositionRow({
  position,
  selected,
  onSelect,
}: {
  position: Position;
  selected: boolean;
  onSelect: (ticker: string) => void;
}) {
  const flash = useFlash(position.current_price);

  return (
    <tr
      onClick={() => onSelect(position.ticker)}
      className={`cursor-pointer border-b border-border/60 transition-colors ${
        selected ? "bg-panel-hover" : "hover:bg-panel-raised"
      }`}
    >
      <td className="numeric px-3 py-1.5 text-left font-semibold text-ink">{position.ticker}</td>
      <td className="numeric px-3 py-1.5 text-right text-ink-dim">
        {fmtQuantity(position.quantity)}
      </td>
      <td className="numeric px-3 py-1.5 text-right text-ink-dim">
        {fmtNumber(position.avg_cost)}
      </td>
      <td className="px-3 py-1.5 text-right">
        <span
          key={flash.flashKey}
          className={`numeric rounded-sm px-1 py-0.5 text-ink ${flash.className}`}
        >
          {fmtNumber(position.current_price)}
        </span>
      </td>
      <td className="numeric px-3 py-1.5 text-right text-ink">
        {fmtCurrency(position.market_value)}
      </td>
      <td className={`numeric px-3 py-1.5 text-right ${signClass(position.unrealized_pnl)}`}>
        {fmtSignedCurrency(position.unrealized_pnl)}
      </td>
      <td
        className={`numeric px-3 py-1.5 text-right ${signClass(position.unrealized_pnl_percent)}`}
      >
        {signGlyph(position.unrealized_pnl_percent)}{" "}
        {fmtPercent(position.unrealized_pnl_percent)}
      </td>
    </tr>
  );
});

export function PositionsTable() {
  const { portfolio, prices, selected, select, loading } = useTerminal();
  const live = useMemo(() => computeLivePortfolio(portfolio, prices), [portfolio, prices]);

  return (
    <Panel
      title="Positions"
      accessory={
        portfolio ? (
          <span className="numeric text-[10px] text-muted">
            Cost basis {fmtCurrency(live.totalCostBasis)}
          </span>
        ) : null
      }
      bodyClassName="overflow-auto"
    >
      {live.positions.length === 0 ? (
        <PanelEmpty>
          {loading ? "Loading portfolio…" : "No positions yet — place a trade below."}
        </PanelEmpty>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-border text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
              {HEADERS.map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-1.5 ${index === 0 ? "text-left" : "text-right"}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {live.positions.map((position) => (
              <PositionRow
                key={position.ticker}
                position={position}
                selected={selected === position.ticker}
                onSelect={select}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-strong bg-panel-raised text-xs">
              <td className="numeric px-3 py-1.5 text-left font-semibold text-ink-dim">TOTAL</td>
              <td colSpan={3} />
              <td className="numeric px-3 py-1.5 text-right font-semibold text-ink">
                {fmtCurrency(live.positionsValue)}
              </td>
              <td
                className={`numeric px-3 py-1.5 text-right font-semibold ${signClass(
                  live.totalUnrealizedPnl,
                )}`}
              >
                {fmtSignedCurrency(live.totalUnrealizedPnl)}
              </td>
              <td
                className={`numeric px-3 py-1.5 text-right font-semibold ${signClass(
                  live.totalUnrealizedPnlPercent,
                )}`}
              >
                {signGlyph(live.totalUnrealizedPnlPercent)}{" "}
                {fmtPercent(live.totalUnrealizedPnlPercent)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </Panel>
  );
}
