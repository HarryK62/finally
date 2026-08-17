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
import { useFlash } from "@/hooks/useFlash";
import { fmtNumber, fmtPercent, signClass, signGlyph } from "@/lib/format";
import { useTerminal } from "@/state/terminal";

const UP = "#3fb950";
const DOWN = "#f85149";
const GRID = "#232b36";
const AXIS = "#6e7c8c";

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { t: number; p: number } }[];
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="rounded-sm border border-border-strong bg-panel-raised px-2 py-1 shadow-lg">
      <div className="numeric text-xs font-semibold text-ink">${fmtNumber(point.p)}</div>
      <div className="numeric text-[10px] text-muted">{clockLabel(point.t)}</div>
    </div>
  );
}

export function MainChart() {
  const { selected, buffers, prices, watchlist } = useTerminal();

  const points = selected ? (buffers[selected] ?? []) : [];
  const tick = selected ? prices[selected] : undefined;
  const watched = watchlist.find((item) => item.ticker === selected);
  const price = tick?.price ?? watched?.price ?? null;
  const flash = useFlash(price);

  const model = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((point) => point.p);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Pad the band so a near-flat series is not drawn as a jagged full-height
    // mountain, and so the line never touches the plot edges.
    const pad = Math.max((max - min) * 0.12, max * 0.0004, 0.01);
    const open = values[0];
    const last = values[values.length - 1];

    return {
      domain: [min - pad, max + pad] as [number, number],
      open,
      changePercent: open === 0 ? 0 : ((last - open) / open) * 100,
      rising: last >= open,
    };
  }, [points]);

  const color = model?.rising ?? true ? UP : DOWN;

  return (
    <Panel
      title={selected ? `${selected} · Session` : "Chart"}
      accessory={
        selected ? (
          <div className="flex items-baseline gap-3">
            <span
              key={flash.flashKey}
              className={`numeric rounded-sm px-1 text-sm font-semibold text-ink ${flash.className}`}
            >
              {price == null ? "—" : `$${fmtNumber(price)}`}
            </span>
            {model ? (
              <span className={`numeric text-[11px] ${signClass(model.changePercent)}`}>
                {signGlyph(model.changePercent)} {fmtPercent(model.changePercent)}
              </span>
            ) : null}
          </div>
        ) : null
      }
      bodyClassName="p-2"
    >
      {!selected ? (
        <PanelEmpty>Select a symbol from the watchlist.</PanelEmpty>
      ) : !model ? (
        <PanelEmpty>
          Accumulating {selected} price history from the live stream…
        </PanelEmpty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mainChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
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
              minTickGap={48}
            />
            <YAxis
              domain={model.domain}
              tickFormatter={(value: number) => fmtNumber(value)}
              tick={{ fill: AXIS, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={58}
              orientation="right"
            />
            <ReferenceLine
              y={model.open}
              stroke={AXIS}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "#209dd7", strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="p"
              stroke={color}
              strokeWidth={2}
              fill="url(#mainChartFill)"
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
