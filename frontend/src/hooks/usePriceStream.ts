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

    const source = new EventSource(apiUrl("/api/stream/prices"));

    source.onopen = () => {
      hasConnected.current = true;
      setStatus("open");
    };

    source.onmessage = (event: MessageEvent<string>) => {
      const frame = parsePriceFrame(event.data);
      if (!frame) return;
      setPrices((prev) => mergeTicks(prev, frame));
      setBuffers((prev) => appendTicks(prev, frame));
      setLastUpdate(Date.now());
      setStatus("open");
    };

    source.onerror = () => {
      // EventSource retries on its own; CONNECTING means a retry is in flight.
      if (source.readyState === EventSource.CLOSED) {
        setStatus("closed");
      } else {
        setStatus(hasConnected.current ? "reconnecting" : "connecting");
      }
    };

    return () => {
      source.close();
    };
  }, []);

  return { prices, buffers, status, lastUpdate };
}
