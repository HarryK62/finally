"use client";

import { memo, useMemo } from "react";

import type { PricePoint } from "@/lib/types";

/**
 * Hand-rolled SVG rather than a charting library: ten of these repaint twice a
 * second, and a full chart runtime per row is an order of magnitude more work
 * than interpolating a polyline.
 *
 * The line is a bare 2px stroke with no axes — at 26px tall the only readable
 * signal is the shape, and gridlines would be noise.
 */
export const Sparkline = memo(function Sparkline({
  points,
  color,
  width = 76,
  height = 26,
  label,
}: {
  points: PricePoint[] | undefined;
  color: string;
  width?: number;
  height?: number;
  label?: string;
}) {
  const geometry = useMemo(() => {
    const values = (points ?? []).map((point) => point.p).filter(Number.isFinite);
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    // A dead-flat series has zero range; draw it down the middle instead of
    // dividing by zero and sending every point to Infinity.
    const span = max - min || 1;
    const padding = 2;
    const usable = height - padding * 2;
    const step = width / (values.length - 1);

    const coords = values.map((value, index) => {
      const x = index * step;
      const y = padding + (1 - (value - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      line: coords.join(" "),
      area: `${coords.join(" ")} ${width},${height} 0,${height}`,
      rising: values[values.length - 1] >= values[0],
    };
  }, [points, width, height]);

  if (!geometry) {
    // Pre-first-tick: a baseline keeps the row height stable so the watchlist
    // does not reflow the moment prices start arriving.
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label ? `${label} sparkline, awaiting data` : "awaiting data"}
        className="overflow-visible"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          className="text-border-strong"
        />
      </svg>
    );
  }

  const gradientId = `spark-${label ?? "x"}-${geometry.rising ? "up" : "down"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ? `${label} price sparkline` : "price sparkline"}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={geometry.area} fill={`url(#${gradientId})`} />
      <polyline
        points={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
