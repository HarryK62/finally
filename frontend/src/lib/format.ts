/**
 * Number formatting. Every helper tolerates `null`, `undefined` and `NaN`,
 * because the first paint happens before any price has streamed in and a
 * terminal that prints "NaN" is worse than one that prints a dash.
 */

export const EMPTY = "—";

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `1234.5` → `"1,234.50"`. No currency symbol; callers add `$` where wanted. */
export function fmtNumber(value: number | null | undefined, dp = 2): string {
  if (!isNum(value)) return EMPTY;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** `1234.5` → `"$1,234.50"`. Negatives render as `-$12.30`, not `$-12.30`. */
export function fmtCurrency(value: number | null | undefined, dp = 2): string {
  if (!isNum(value)) return EMPTY;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${fmtNumber(Math.abs(value), dp)}`;
}

/** Currency with an explicit leading sign — for P&L, where polarity is the point. */
export function fmtSignedCurrency(value: number | null | undefined, dp = 2): string {
  if (!isNum(value)) return EMPTY;
  const sign = value < 0 ? "-" : "+";
  return `${sign}$${fmtNumber(Math.abs(value), dp)}`;
}

/** `2.63` → `"+2.63%"`. The API already sends percent units, not fractions. */
export function fmtPercent(value: number | null | undefined, dp = 2): string {
  if (!isNum(value)) return EMPTY;
  const sign = value < 0 ? "-" : "+";
  return `${sign}${fmtNumber(Math.abs(value), dp)}%`;
}

/** Share counts: up to 6 dp per contract §3, with trailing zeros trimmed. */
export function fmtQuantity(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  const [whole, frac] = fixed.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Compact form for axis ticks: `12345` → `"12.3k"`. */
export function fmtCompact(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(abs >= 100 ? 0 : 2);
}

/** `▲` / `▼` / `·` — the redundant, non-color encoding of direction. */
export function signGlyph(value: number | null | undefined): string {
  if (!isNum(value) || value === 0) return "·";
  return value > 0 ? "▲" : "▼";
}

/** Tailwind text class for a signed value. Neutral when flat or unknown. */
export function signClass(value: number | null | undefined): string {
  if (!isNum(value) || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
}

/** `"2026-08-17T14:03:22.481Z"` → `"14:03:22"` in the viewer's local time. */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** The SSE stream sends Unix *seconds* as a float — convert once, at the edge. */
export function tickTimeToMs(timestamp: number): number {
  return Number.isFinite(timestamp) ? timestamp * 1000 : Date.now();
}
