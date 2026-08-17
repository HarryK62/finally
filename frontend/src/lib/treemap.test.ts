import { describe, expect, it } from "vitest";

import { squarify, type TreemapInput, type TreemapRect } from "./treemap";

const W = 400;
const H = 300;

function area(rect: TreemapRect): number {
  return rect.w * rect.h;
}

function overlaps(a: TreemapRect, b: TreemapRect): boolean {
  const EPS = 1e-6;
  return (
    a.x < b.x + b.w - EPS &&
    b.x < a.x + a.w - EPS &&
    a.y < b.y + b.h - EPS &&
    b.y < a.y + a.h - EPS
  );
}

const weights: TreemapInput[] = [
  { key: "AAPL", value: 0.4 },
  { key: "NVDA", value: 0.25 },
  { key: "MSFT", value: 0.2 },
  { key: "TSLA", value: 0.1 },
  { key: "JPM", value: 0.05 },
];

describe("squarify", () => {
  it("returns a rect per input", () => {
    const rects = squarify(weights, W, H);
    expect(rects.map((rect) => rect.key).sort()).toEqual(
      weights.map((item) => item.key).sort(),
    );
  });

  it("fills the whole region without leaving gaps", () => {
    const total = squarify(weights, W, H).reduce((sum, rect) => sum + area(rect), 0);
    expect(total).toBeCloseTo(W * H, 4);
  });

  it("sizes each cell in proportion to its weight", () => {
    const rects = squarify(weights, W, H);
    const byKey = new Map(rects.map((rect) => [rect.key, rect]));

    for (const item of weights) {
      expect(area(byKey.get(item.key)!)).toBeCloseTo(item.value * W * H, 4);
    }
  });

  it("produces non-overlapping cells inside the bounds", () => {
    const rects = squarify(weights, W, H);

    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(W + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(H + 1e-6);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it("keeps cells reasonably square rather than slivered", () => {
    // The point of the squarified variant: no cell should be a 10:1 ribbon.
    for (const rect of squarify(weights, W, H)) {
      expect(Math.max(rect.w / rect.h, rect.h / rect.w)).toBeLessThan(5);
    }
  });

  it("gives a single item the whole region", () => {
    const [rect] = squarify([{ key: "AAPL", value: 1 }], W, H);
    expect(rect).toEqual({ key: "AAPL", x: 0, y: 0, w: W, h: H });
  });

  it("drops non-positive and non-finite values", () => {
    const rects = squarify(
      [
        { key: "AAPL", value: 1 },
        { key: "ZERO", value: 0 },
        { key: "NEG", value: -1 },
        { key: "NAN", value: Number.NaN },
      ],
      W,
      H,
    );
    expect(rects.map((rect) => rect.key)).toEqual(["AAPL"]);
  });

  it("returns nothing for an empty list or a zero-sized region", () => {
    expect(squarify([], W, H)).toEqual([]);
    expect(squarify(weights, 0, H)).toEqual([]);
    expect(squarify(weights, W, 0)).toEqual([]);
  });

  it("normalises weights that do not sum to one", () => {
    const rects = squarify(
      [
        { key: "A", value: 3 },
        { key: "B", value: 1 },
      ],
      W,
      H,
    );
    const byKey = new Map(rects.map((rect) => [rect.key, rect]));
    expect(area(byKey.get("A")!) / area(byKey.get("B")!)).toBeCloseTo(3, 6);
  });
});
