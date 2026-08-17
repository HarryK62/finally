import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "./Sparkline";
import type { PricePoint } from "@/lib/types";

function points(...values: number[]): PricePoint[] {
  return values.map((p, index) => ({ t: 1_700_000_000_000 + index * 500, p }));
}

function coordinates(): [number, number][] {
  const polyline = document.querySelector("polyline");
  const raw = polyline?.getAttribute("points") ?? "";
  return raw
    .split(" ")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
}

describe("Sparkline", () => {
  it("draws a placeholder baseline before two points have arrived", () => {
    const { rerender } = render(<Sparkline points={undefined} color="#3fb950" label="AAPL" />);
    expect(screen.getByRole("img", { name: "AAPL sparkline, awaiting data" })).toBeInTheDocument();
    expect(document.querySelector("polyline")).toBeNull();

    rerender(<Sparkline points={points(190)} color="#3fb950" label="AAPL" />);
    expect(screen.getByRole("img", { name: "AAPL sparkline, awaiting data" })).toBeInTheDocument();
  });

  it("plots one vertex per point across the full width", () => {
    render(<Sparkline points={points(1, 2, 3, 4, 5)} color="#3fb950" label="AAPL" width={80} />);

    const coords = coordinates();
    expect(coords).toHaveLength(5);
    expect(coords[0][0]).toBe(0);
    expect(coords[4][0]).toBe(80);
    // Rising series: y decreases as price increases (SVG y grows downward).
    expect(coords[4][1]).toBeLessThan(coords[0][1]);
  });

  it("draws a flat series down the middle instead of dividing by zero", () => {
    render(<Sparkline points={points(100, 100, 100)} color="#6e7c8c" height={26} />);

    for (const [, y] of coordinates()) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(26);
    }
  });

  it("ignores non-finite values in the buffer", () => {
    render(
      <Sparkline
        points={[
          { t: 1, p: 10 },
          { t: 2, p: Number.NaN },
          { t: 3, p: 12 },
        ]}
        color="#3fb950"
      />,
    );

    expect(coordinates()).toHaveLength(2);
  });
});
