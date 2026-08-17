import { describe, expect, it } from "vitest";

import {
  MAX_POINTS,
  appendTicks,
  mergeTicks,
  parsePriceFrame,
  pruneBuffers,
  pushPoint,
} from "./priceBuffer";
import type { PriceMap, PricePoint } from "./types";
import { tick } from "@/test/harness";

function frame(...ticks: ReturnType<typeof tick>[]): PriceMap {
  return Object.fromEntries(ticks.map((entry) => [entry.ticker, entry]));
}

describe("mergeTicks", () => {
  it("returns the previous map identity when nothing moved", () => {
    const prev = frame(tick("AAPL", 190), tick("MSFT", 410));
    const next = mergeTicks(prev, frame(tick("AAPL", 190), tick("MSFT", 410)));
    expect(next).toBe(prev);
  });

  it("replaces only the tickers whose price actually changed", () => {
    const prev = frame(tick("AAPL", 190), tick("MSFT", 410));
    const incoming = frame(tick("AAPL", 191, 190), tick("MSFT", 410));

    const next = mergeTicks(prev, incoming);

    expect(next).not.toBe(prev);
    expect(next.AAPL.price).toBe(191);
    // Identity preserved so memoised rows for unmoved tickers do not re-render.
    expect(next.MSFT).toBe(prev.MSFT);
  });

  it("adds tickers it has never seen", () => {
    const next = mergeTicks({}, frame(tick("NVDA", 900)));
    expect(Object.keys(next)).toEqual(["NVDA"]);
  });

  it("treats a same-price tick at a new timestamp as an update", () => {
    const prev = frame(tick("AAPL", 190));
    const later = { ...prev.AAPL, timestamp: prev.AAPL.timestamp + 0.5 };

    const next = mergeTicks(prev, { AAPL: later });

    expect(next).not.toBe(prev);
    expect(next.AAPL.timestamp).toBe(later.timestamp);
  });
});

describe("pushPoint", () => {
  it("appends to an absent buffer", () => {
    expect(pushPoint(undefined, { t: 1, p: 10 })).toEqual([{ t: 1, p: 10 }]);
  });

  it("ignores an exact repeat of the last point", () => {
    const buffer: PricePoint[] = [{ t: 1, p: 10 }];
    expect(pushPoint(buffer, { t: 1, p: 10 })).toBe(buffer);
  });

  it("caps the ring buffer and drops the oldest point", () => {
    let buffer: PricePoint[] = [];
    for (let i = 0; i < MAX_POINTS + 40; i += 1) {
      buffer = pushPoint(buffer, { t: i, p: 100 + i });
    }

    expect(MAX_POINTS).toBe(120);
    expect(buffer).toHaveLength(MAX_POINTS);
    expect(buffer[0]).toEqual({ t: 40, p: 140 });
    expect(buffer[buffer.length - 1]).toEqual({ t: 159, p: 259 });
  });

  it("honours a custom cap", () => {
    let buffer: PricePoint[] = [];
    for (let i = 0; i < 10; i += 1) buffer = pushPoint(buffer, { t: i, p: i }, 3);
    expect(buffer).toEqual([
      { t: 7, p: 7 },
      { t: 8, p: 8 },
      { t: 9, p: 9 },
    ]);
  });

  it("never mutates the buffer it was given", () => {
    const buffer: PricePoint[] = [{ t: 1, p: 10 }];
    pushPoint(buffer, { t: 2, p: 11 });
    expect(buffer).toEqual([{ t: 1, p: 10 }]);
  });
});

describe("appendTicks", () => {
  it("converts the float-seconds timestamp to milliseconds", () => {
    const buffers = appendTicks({}, frame(tick("AAPL", 190)));
    expect(buffers.AAPL).toHaveLength(1);
    expect(buffers.AAPL[0].p).toBe(190);
    expect(buffers.AAPL[0].t).toBeCloseTo(1_755_439_402_480, 0);
  });

  it("keeps array identity for tickers that did not move", () => {
    const first = appendTicks({}, frame(tick("AAPL", 190), tick("MSFT", 410)));
    const moved = { ...tick("AAPL", 191, 190), timestamp: 1_755_439_403.0 };

    const second = appendTicks(first, { AAPL: moved, MSFT: tick("MSFT", 410) });

    expect(second.AAPL).toHaveLength(2);
    expect(second.MSFT).toBe(first.MSFT);
  });

  it("returns the same object when no buffer changed", () => {
    const first = appendTicks({}, frame(tick("AAPL", 190)));
    expect(appendTicks(first, frame(tick("AAPL", 190)))).toBe(first);
  });

  it("skips ticks with a non-finite price", () => {
    const bad = { ...tick("AAPL", 0), price: Number.NaN };
    expect(appendTicks({}, { AAPL: bad })).toEqual({});
  });

  it("caps each per-ticker buffer at 120 points across many frames", () => {
    let buffers: Record<string, PricePoint[]> = {};
    for (let i = 0; i < 300; i += 1) {
      const entry = { ...tick("AAPL", 190 + i * 0.01), timestamp: 1_700_000_000 + i * 0.5 };
      buffers = appendTicks(buffers, { AAPL: entry });
    }
    expect(buffers.AAPL).toHaveLength(120);
  });
});

describe("pruneBuffers", () => {
  it("drops buffers for tickers no longer watched", () => {
    const buffers = { AAPL: [{ t: 1, p: 1 }], TSLA: [{ t: 1, p: 1 }] };
    expect(Object.keys(pruneBuffers(buffers, ["AAPL"]))).toEqual(["AAPL"]);
  });

  it("returns the same object when nothing is surplus", () => {
    const buffers = { AAPL: [{ t: 1, p: 1 }] };
    expect(pruneBuffers(buffers, ["AAPL", "MSFT"])).toBe(buffers);
  });
});

describe("parsePriceFrame", () => {
  it("parses a well-formed ticker map", () => {
    const raw = JSON.stringify({
      AAPL: {
        ticker: "AAPL",
        price: 190.25,
        previous_price: 190,
        timestamp: 1_755_439_402.48,
        change: 0.25,
        change_percent: 0.13,
        direction: "up",
      },
    });

    expect(parsePriceFrame(raw)).toEqual({
      AAPL: {
        ticker: "AAPL",
        price: 190.25,
        previous_price: 190,
        timestamp: 1_755_439_402.48,
        change: 0.25,
        change_percent: 0.13,
        direction: "up",
      },
    });
  });

  it("fills defaults for missing optional fields", () => {
    const parsed = parsePriceFrame(JSON.stringify({ AAPL: { price: 190 } }));
    expect(parsed?.AAPL.ticker).toBe("AAPL");
    expect(parsed?.AAPL.previous_price).toBe(190);
    expect(parsed?.AAPL.change).toBe(0);
    expect(parsed?.AAPL.direction).toBe("flat");
    expect(Number.isFinite(parsed?.AAPL.timestamp)).toBe(true);
  });

  it("degrades to null rather than throwing on garbage", () => {
    expect(parsePriceFrame("not json")).toBeNull();
    expect(parsePriceFrame("[]")).toBeNull();
    expect(parsePriceFrame("null")).toBeNull();
    expect(parsePriceFrame("{}")).toBeNull();
    expect(parsePriceFrame(JSON.stringify({ AAPL: { price: "190" } }))).toBeNull();
  });

  it("drops individual bad entries but keeps the good ones", () => {
    const parsed = parsePriceFrame(
      JSON.stringify({ AAPL: { price: 190 }, BAD: { price: null } }),
    );
    expect(Object.keys(parsed ?? {})).toEqual(["AAPL"]);
  });

  it("rejects an unknown direction value", () => {
    const parsed = parsePriceFrame(
      JSON.stringify({ AAPL: { price: 190, direction: "sideways" } }),
    );
    expect(parsed?.AAPL.direction).toBe("flat");
  });
});
