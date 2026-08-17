/**
 * Pure reducers behind the SSE price stream.
 *
 * Kept out of the hook so they can be unit-tested without a browser and, more
 * importantly, so the identity-preserving merge is a single obvious place: the
 * server re-sends the full ticker map ~2x/second, and if we blindly replaced
 * state every watchlist row would re-render every 500ms.
 */

import type { PriceMap, PricePoint, PriceTick } from "./types";
import { tickTimeToMs } from "./format";

/** Sparkline ring-buffer depth (contract §8). ~60s of history at 2 ticks/sec. */
export const MAX_POINTS = 120;

function sameTick(a: PriceTick | undefined, b: PriceTick): boolean {
  return a !== undefined && a.price === b.price && a.timestamp === b.timestamp;
}

/**
 * Merge an incoming SSE payload into the current map, reusing the previous
 * object for any ticker whose price and timestamp are unchanged. Returns `prev`
 * itself when nothing moved, so `useState` can bail out of the render entirely.
 */
export function mergeTicks(prev: PriceMap, incoming: PriceMap): PriceMap {
  let changed = false;
  const next: PriceMap = { ...prev };

  for (const [ticker, tick] of Object.entries(incoming)) {
    if (sameTick(prev[ticker], tick)) continue;
    next[ticker] = tick;
    changed = true;
  }

  return changed ? next : prev;
}

/** Append a point, dropping the oldest once the buffer is full. */
export function pushPoint(
  buffer: PricePoint[] | undefined,
  point: PricePoint,
  cap = MAX_POINTS,
): PricePoint[] {
  const base = buffer ?? [];
  const last = base[base.length - 1];
  // The stream repeats the last payload whenever the cache version is bumped
  // without this ticker moving; don't store the duplicate.
  if (last && last.t === point.t && last.p === point.p) return base;

  const next = base.length >= cap ? base.slice(base.length - cap + 1) : base.slice();
  next.push(point);
  return next;
}

/**
 * Fold an SSE payload into the per-ticker sparkline buffers. Buffers for
 * tickers that did not move keep their array identity.
 */
export function appendTicks(
  buffers: Record<string, PricePoint[]>,
  incoming: PriceMap,
  cap = MAX_POINTS,
): Record<string, PricePoint[]> {
  let changed = false;
  const next: Record<string, PricePoint[]> = { ...buffers };

  for (const [ticker, tick] of Object.entries(incoming)) {
    if (!Number.isFinite(tick.price)) continue;
    const appended = pushPoint(
      buffers[ticker],
      { t: tickTimeToMs(tick.timestamp), p: tick.price },
      cap,
    );
    if (appended !== buffers[ticker]) {
      next[ticker] = appended;
      changed = true;
    }
  }

  return changed ? next : buffers;
}

/** Drop buffers for tickers no longer on the watchlist, so memory stays bounded. */
export function pruneBuffers(
  buffers: Record<string, PricePoint[]>,
  keep: readonly string[],
): Record<string, PricePoint[]> {
  const allowed = new Set(keep);
  const surplus = Object.keys(buffers).filter((ticker) => !allowed.has(ticker));
  if (surplus.length === 0) return buffers;

  const next = { ...buffers };
  for (const ticker of surplus) delete next[ticker];
  return next;
}

/**
 * Parse one SSE `data:` frame. Returns `null` for anything that is not the
 * expected ticker map, so a malformed frame degrades to "no update" rather than
 * tearing down the stream.
 */
export function parsePriceFrame(raw: string): PriceMap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const out: PriceMap = {};
  for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
    const tick = value as Partial<PriceTick>;
    if (typeof tick?.price !== "number" || !Number.isFinite(tick.price)) continue;
    out[ticker] = {
      ticker: typeof tick.ticker === "string" ? tick.ticker : ticker,
      price: tick.price,
      previous_price: typeof tick.previous_price === "number" ? tick.previous_price : tick.price,
      timestamp: typeof tick.timestamp === "number" ? tick.timestamp : Date.now() / 1000,
      change: typeof tick.change === "number" ? tick.change : 0,
      change_percent: typeof tick.change_percent === "number" ? tick.change_percent : 0,
      direction: tick.direction === "up" || tick.direction === "down" ? tick.direction : "flat",
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}
