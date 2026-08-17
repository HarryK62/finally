import { describe, expect, it } from "vitest";

import { HEAT_CLAMP, heatFill, heatStroke } from "./heat";

const NEUTRAL = "#2b323c";
const FULL_UP = "#1f7a3a";
const FULL_DOWN = "#a6302f";

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

describe("heatFill", () => {
  it("returns a six-digit hex colour for any input", () => {
    for (const value of [-100, -0.001, 0, 0.001, 100, null, Number.NaN]) {
      expect(heatFill(value)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("uses the neutral step for flat, missing and non-finite P&L", () => {
    expect(heatFill(0)).toBe(NEUTRAL);
    expect(heatFill(null)).toBe(NEUTRAL);
    expect(heatFill(undefined)).toBe(NEUTRAL);
    expect(heatFill(Number.NaN)).toBe(NEUTRAL);
  });

  it("reaches full saturation at the clamp and stays there beyond it", () => {
    expect(heatFill(HEAT_CLAMP)).toBe(FULL_UP);
    expect(heatFill(HEAT_CLAMP * 20)).toBe(FULL_UP);
    expect(heatFill(-HEAT_CLAMP)).toBe(FULL_DOWN);
    expect(heatFill(-HEAT_CLAMP * 20)).toBe(FULL_DOWN);
  });

  it("moves green for gains and red for losses", () => {
    const [, gainGreen] = channels(heatFill(2));
    const [lossRed] = channels(heatFill(-2));
    const [neutralRed, neutralGreen] = channels(NEUTRAL);

    expect(gainGreen).toBeGreaterThan(neutralGreen);
    expect(lossRed).toBeGreaterThan(neutralRed);
  });

  it("is monotonic in magnitude", () => {
    const greens = [0.5, 1, 2, 4, 5].map((percent) => channels(heatFill(percent))[1]);
    for (let i = 1; i < greens.length; i += 1) {
      expect(greens[i]).toBeGreaterThanOrEqual(greens[i - 1]);
    }
  });

  it("eases with a square root, so small moves are already visible", () => {
    // Linear interpolation would put 1.25% (a quarter of the clamp) at t=0.25;
    // the sqrt ramp puts it at t=0.5.
    const [, easedGreen] = channels(heatFill(HEAT_CLAMP / 4));
    const [, neutralGreen] = channels(NEUTRAL);
    const [, fullGreen] = channels(FULL_UP);
    const t = (easedGreen - neutralGreen) / (fullGreen - neutralGreen);
    expect(t).toBeCloseTo(0.5, 2);
  });
});

describe("heatStroke", () => {
  it("distinguishes gain, loss and neutral borders", () => {
    expect(heatStroke(1)).toBe("#2ea043");
    expect(heatStroke(-1)).toBe("#cf3f3a");
    expect(heatStroke(0)).toBe("#3a434f");
    expect(heatStroke(null)).toBe("#3a434f");
    expect(heatStroke(Number.NaN)).toBe("#3a434f");
  });
});
