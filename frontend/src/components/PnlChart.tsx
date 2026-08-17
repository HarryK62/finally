"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Panel, PanelEmpty } from "@/components/Panel";
import { fmtCompact, fmtCurrency, fmtPercent, signClass, signGlyph } from "@/lib/format";
import { computeLivePortfolio } from "@/lib/portfolio";
import { useTerminal } from "@/state/terminal";

const UP = "#3fb950";
const DOWN = "#f85149";
const GRID = "#232b36";
const AXIS = "#6e7c8c";

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PnlTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { t: number; v: number } }[];
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="rounded-sm border border-border-strong bg-panel-raised px-2 py-1 shadow-lg">
      <div className="numeric text-xs font-semibold text-ink">{fmtCurrency(point.v)}</div>
      <div className="numeric text-[10px] text-muted">
        {new Date(point.t).toLocaleTimeString("en-GB", { hour12: false })}
      </div>
    </div>
  );
}

export function PnlChart() {
  const { snapshots, portfolio, prices } = useTerminal();
  const live = useMemo(() => computeLivePortfolio(portfolio, prices), [portfolio, prices]);

  const model = useMemo(() => {
    const series = snapshots
      .map((snapshot) => ({
        t: new Date(snapshot.recorded_at).getTime(),
        v: snapshot.total_value,
      }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v));

    // Snapshots land every 30s; pin the live value on the end so the line does
    // not visibly lag the header.
    if (portfolio) {
      const now = Date.now();
      const last = series[series.length - 1];
      if (!last || now - last.t > 1000) series.push({ t: now, v: live.totalValue });
    }

    if (series.length < 2) return null;

    const values = series.map((point) => point.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.15, max * 0.001, 1);
    const open = values[0];
    const last = values[values.length - 1];

    return {
      series,
      open,
      domain: [min - pad, max + pad] as [number, number],
      change: last - open,
      changePercent: open === 0 ? 0 : ((last - open) / open) * 100,
      rising: last >= open,
    };
  }, [snapshots, portfolio, live.totalValue]);

  const color = model?.rising ?? true ? UP : DOWN;

  return (
    <Panel
      title="Portfolio Value"
      accessory={
        model ? (
          <span className={`numeric text-[11px] ${signClass(model.change)}`}>
            {signGlyph(model.change)} {fmtPercent(model.changePercent)}
          </span>
        ) : null
      }
      bodyClassName="p-2"
    >
      {!model ? (
        <PanelEmpty>Portfolio value is snapshotted every 30s — building history…</PanelEmpty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={model.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={clockLabel}
              tick={{ fill: AXIS, fontSize: 10 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={model.domain}
              tickFormatter={(value: number) => fmtCompact(value)}
              tick={{ fill: AXIS, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={48}
              orientation="right"
            />
            <ReferenceLine y={model.open} stroke={AXIS} strokeDasharray="3 3" strokeOpacity={0.6} />
            <Tooltip
              content={<PnlTooltip />}
              cursor={{ stroke: "#209dd7", strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill="url(#pnlFill)"
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 3, fill: color, stroke: "#0d1117", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
