"use client";

/**
 * Live price feed. One `EventSource` for the whole app; every consumer reads the
 * merged map out of context rather than opening its own connection.
 */

import { useEffect, useRef, useState } from "react";

import { apiUrl } from "@/lib/api";
import { appendTicks, mergeTicks, parsePriceFrame } from "@/lib/priceBuffer";
import type { PriceMap, PricePoint } from "@/lib/types";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

/** First re-create attempt after a fatal close, doubling up to {@link RETRY_MAX_MS}. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export interface PriceStream {
  prices: PriceMap;
  /** Per-ticker sparkline ring buffers, accumulated since page load. */
  buffers: Record<string, PricePoint[]>;
  status: ConnectionStatus;
  /** Milliseconds since epoch of the last frame, or 0 if none has arrived. */
  lastUpdate: number;
}

export function usePriceStream(): PriceStream {
  const [prices, setPrices] = useState<PriceMap>({});
  const [buffers, setBuffers] = useState<Record<string, PricePoint[]>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState(0);

  // Once the stream has been open, a drop back to CONNECTING is a retry rather
  // than a first connection — that distinction is the yellow vs. red dot.
  const hasConnected = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let disposed = false;

    const connect = () => {
      const current = new EventSource(apiUrl("/api/stream/prices"));
      source = current;

      current.onopen = () => {
        // A live connection earns a clean slate for the backoff.
        failures = 0;
        hasConnected.current = true;
        setStatus("open");
      };

      current.onmessage = (event: MessageEvent<string>) => {
        const frame = parsePriceFrame(event.data);
        if (!frame) return;
        setPrices((prev) => mergeTicks(prev, frame));
        setBuffers((prev) => appendTicks(prev, frame));
        setLastUpdate(Date.now());
        setStatus("open");
      };

      current.onerror = () => {
        // A source we already replaced must not steer the live one.
        if (source !== current) return;
        if (current.readyState !== EventSource.CLOSED) {
          // EventSource retries transient errors itself; CONNECTING means a
          // retry is in flight.
          setStatus(hasConnected.current ? "reconnecting" : "connecting");
          return;
        }
        // CLOSED is fatal: the browser will never retry, so the feed stays dead
        // until we build a new EventSource ourselves.
        setStatus("closed");
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
      failures += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (disposed) return;
        source?.close();
        setStatus(hasConnected.current ? "reconnecting" : "connecting");
        connect();
      }, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  return { prices, buffers, status, lastUpdate };
}
