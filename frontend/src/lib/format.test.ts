import { describe, expect, it } from "vitest";

import {
  EMPTY,
  fmtClock,
  fmtCompact,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  fmtQuantity,
  fmtSignedCurrency,
  signClass,
  signGlyph,
  tickTimeToMs,
} from "./format";

/** Every formatter must survive the pre-first-paint state without printing NaN. */
const BLANKS = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY] as const;

describe("fmtNumber", () => {
  it("groups thousands and pads to two decimals", () => {
    expect(fmtNumber(1234.5)).toBe("1,234.50");
    expect(fmtNumber(0)).toBe("0.00");
    expect(fmtNumber(-9.126)).toBe("-9.13");
  });

  it("honours an explicit decimal count", () => {
    expect(fmtNumber(1234.5678, 4)).toBe("1,234.5678");
    expect(fmtNumber(1234.5678, 0)).toBe("1,235");
  });

  it("renders a dash for anything that is not a finite number", () => {
    for (const blank of BLANKS) expect(fmtNumber(blank)).toBe(EMPTY);
  });
});

describe("fmtCurrency", () => {
  it("puts the sign outside the dollar symbol", () => {
    expect(fmtCurrency(1234.5)).toBe("$1,234.50");
    expect(fmtCurrency(-12.3)).toBe("-$12.30");
    expect(fmtCurrency(0)).toBe("$0.00");
  });

  it("renders a dash for missing values", () => {
    for (const blank of BLANKS) expect(fmtCurrency(blank)).toBe(EMPTY);
  });
});

describe("fmtSignedCurrency", () => {
  it("always shows polarity, including for gains", () => {
    expect(fmtSignedCurrency(1234.5)).toBe("+$1,234.50");
    expect(fmtSignedCurrency(-1234.5)).toBe("-$1,234.50");
    expect(fmtSignedCurrency(0)).toBe("+$0.00");
  });

  it("renders a dash for missing values", () => {
    for (const blank of BLANKS) expect(fmtSignedCurrency(blank)).toBe(EMPTY);
  });
});

describe("fmtPercent", () => {
  it("treats the input as percent units, not a fraction", () => {
    expect(fmtPercent(2.63)).toBe("+2.63%");
    expect(fmtPercent(-0.014)).toBe("-0.01%");
    expect(fmtPercent(0)).toBe("+0.00%");
  });

  it("renders a dash for missing values", () => {
    for (const blank of BLANKS) expect(fmtPercent(blank)).toBe(EMPTY);
  });
});

describe("fmtQuantity", () => {
  it("trims trailing zeros and groups the whole part", () => {
    expect(fmtQuantity(10)).toBe("10");
    expect(fmtQuantity(1000)).toBe("1,000");
    expect(fmtQuantity(1234.5)).toBe("1,234.5");
    expect(fmtQuantity(0.5)).toBe("0.5");
    expect(fmtQuantity(0)).toBe("0");
  });

  it("keeps up to six decimal places of a fractional share", () => {
    expect(fmtQuantity(0.123456)).toBe("0.123456");
    expect(fmtQuantity(0.1234564)).toBe("0.123456");
  });

  it("renders a dash for missing values", () => {
    for (const blank of BLANKS) expect(fmtQuantity(blank)).toBe(EMPTY);
  });
});

describe("fmtCompact", () => {
  it("abbreviates thousands and millions", () => {
    expect(fmtCompact(12_345)).toBe("12.3k");
    expect(fmtCompact(-1_500)).toBe("-1.5k");
    expect(fmtCompact(2_400_000)).toBe("2.4M");
  });

  it("keeps cents below 100 and drops them above", () => {
    expect(fmtCompact(9.5)).toBe("9.50");
    expect(fmtCompact(250.4)).toBe("250");
  });

  it("renders a dash for missing values", () => {
    for (const blank of BLANKS) expect(fmtCompact(blank)).toBe(EMPTY);
  });
});

describe("direction encoding", () => {
  it("maps sign to a non-colour glyph", () => {
    expect(signGlyph(1)).toBe("▲");
    expect(signGlyph(-1)).toBe("▼");
    expect(signGlyph(0)).toBe("·");
    expect(signGlyph(null)).toBe("·");
  });

  it("maps sign to the up/down/muted text classes", () => {
    expect(signClass(0.01)).toBe("text-up");
    expect(signClass(-0.01)).toBe("text-down");
    expect(signClass(0)).toBe("text-muted");
    expect(signClass(Number.NaN)).toBe("text-muted");
  });
});

describe("fmtClock", () => {
  it("renders a 24h wall clock", () => {
    expect(fmtClock("2026-08-17T14:03:22.481Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("renders a dash for null and unparseable input", () => {
    expect(fmtClock(null)).toBe(EMPTY);
    expect(fmtClock(undefined)).toBe(EMPTY);
    expect(fmtClock("not a date")).toBe(EMPTY);
  });
});

describe("tickTimeToMs", () => {
  it("converts the SSE float-seconds timestamp to milliseconds", () => {
    expect(tickTimeToMs(1_755_439_402.48)).toBeCloseTo(1_755_439_402_480, 0);
  });

  it("falls back to now when the timestamp is not finite", () => {
    const before = Date.now();
    const result = tickTimeToMs(Number.NaN);
    expect(result).toBeGreaterThanOrEqual(before);
  });
});
