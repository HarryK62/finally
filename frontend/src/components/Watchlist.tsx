"use client";

import { memo, useMemo, useState, type FormEvent } from "react";

import { Panel, PanelEmpty } from "@/components/Panel";
import { Sparkline } from "@/components/Sparkline";
import { useFlash } from "@/hooks/useFlash";
import { ApiError } from "@/lib/api";
import { fmtNumber, fmtPercent, signClass, signGlyph } from "@/lib/format";
import type { PricePoint, PriceTick, WatchlistItem } from "@/lib/types";
import { useTerminal } from "@/state/terminal";

const UP = "#3fb950";
const DOWN = "#f85149";
const FLAT = "#6e7c8c";

/**
 * Change since the page loaded, derived from the sparkline buffer.
 *
 * The stream's own `change_percent` is tick-over-tick — a ±0.02% number that
 * flickers meaninglessly. The first point in the buffer is the first price this
 * session saw, so this is the move the sparkline actually draws.
 */
function sessionChangePercent(
  points: PricePoint[] | undefined,
  price: number | null,
): number | null {
  if (price == null || !points || points.length < 2) return null;
  const first = points[0].p;
  if (!Number.isFinite(first) || first === 0) return null;
  return ((price - first) / first) * 100;
}

const WatchlistRow = memo(function WatchlistRow({
  item,
  tick,
  points,
  selected,
  onSelect,
  onRemove,
}: {
  item: WatchlistItem;
  tick: PriceTick | undefined;
  points: PricePoint[] | undefined;
  selected: boolean;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}) {
  const price = tick?.price ?? item.price ?? null;
  const flash = useFlash(price);

  const session = sessionChangePercent(points, price);
  // Until the buffer has two points, the stream's tick-over-tick move is all we
  // have; it is small but it is not wrong.
  const change = session ?? (tick?.change_percent ?? item.change_percent);
  const sparkColor = change > 0 ? UP : change < 0 ? DOWN : FLAT;

  return (
    <div
      className={`group grid grid-cols-[minmax(0,1fr)_76px_minmax(0,88px)] items-center gap-2 border-l-2 px-3 py-1.5 text-xs transition-colors ${
        selected
          ? "border-l-accent bg-panel-hover"
          : "border-l-transparent hover:bg-panel-raised"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(item.ticker)}
        className="flex min-w-0 flex-col items-start gap-0.5 text-left"
        aria-pressed={selected}
        aria-label={`Select ${item.ticker}`}
      >
        <span className="numeric text-[13px] font-semibold leading-none text-ink">
          {item.ticker}
        </span>
        <span className={`numeric text-[10px] leading-none ${signClass(change)}`}>
          {signGlyph(change)} {fmtPercent(change)}
        </span>
      </button>

      <div className="flex justify-center" aria-hidden={points === undefined}>
        <Sparkline points={points} color={sparkColor} label={item.ticker} />
      </div>

      <div className="flex items-center justify-end gap-1">
        <span
          key={flash.flashKey}
          className={`numeric rounded-sm px-1 py-0.5 text-[13px] tabular-nums text-ink ${flash.className}`}
          data-testid={`price-${item.ticker}`}
        >
          {price == null ? "—" : fmtNumber(price)}
        </span>
        <button
          type="button"
          onClick={() => onRemove(item.ticker)}
          aria-label={`Remove ${item.ticker} from watchlist`}
          title={`Remove ${item.ticker}`}
          className="w-4 shrink-0 text-center text-sm leading-none text-muted opacity-0 transition-opacity hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
});

export function Watchlist({ className = "" }: { className?: string }) {
  const { watchlist, prices, buffers, selected, select, addTicker, removeTicker } = useTerminal();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tickers = useMemo(() => watchlist.map((item) => item.ticker), [watchlist]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (!ticker) return;

    setBusy(true);
    setError(null);
    try {
      await addTicker(ticker);
      setDraft("");
      select(ticker);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add ticker");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(ticker: string) {
    setError(null);
    try {
      await removeTicker(ticker);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove ticker");
    }
  }

  return (
    <Panel
      title="Watchlist"
      accessory={
        <span className="numeric text-[10px] text-muted">{tickers.length} symbols</span>
      }
      className={className}
      bodyClassName="flex flex-col"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_76px_minmax(0,88px)] gap-2 border-b border-border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span>Symbol / Session</span>
        <span className="text-center">Trend</span>
        <span className="text-right">Last</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <PanelEmpty>No symbols watched. Add one below.</PanelEmpty>
        ) : (
          watchlist.map((item) => (
            <WatchlistRow
              key={item.ticker}
              item={item}
              tick={prices[item.ticker]}
              points={buffers[item.ticker]}
              selected={selected === item.ticker}
              onSelect={select}
              onRemove={handleRemove}
            />
          ))
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="shrink-0 border-t border-border bg-panel-raised p-2"
      >
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="ADD SYMBOL"
            aria-label="Add ticker to watchlist"
            maxLength={8}
            className="numeric min-w-0 flex-1 rounded-sm border border-border bg-terminal px-2 py-1 text-xs uppercase text-ink placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="rounded-sm bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-1.5 text-[11px] leading-tight text-down">
            {error}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
