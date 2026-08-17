import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_POINTS } from "@/lib/priceBuffer";
import { usePriceStream } from "./usePriceStream";

/**
 * A hand-driven EventSource: tests push frames and error transitions rather
 * than waiting on a network the browser would otherwise own.
 */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    act(() => this.onopen?.(new Event("open")));
  }

  emitData(payload: unknown) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    act(() => this.onmessage?.(new MessageEvent("message", { data })));
  }

  /** `readyState` decides whether the hook reads this as a retry or a death. */
  emitError(readyState: number) {
    this.readyState = readyState;
    act(() => this.onerror?.(new Event("error")));
  }
}

function Probe() {
  const { prices, buffers, status, lastUpdate } = usePriceStream();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="tickers">{Object.keys(prices).sort().join(",")}</span>
      <span data-testid="aapl">{prices.AAPL ? prices.AAPL.price : "none"}</span>
      <span data-testid="buffer">{(buffers.AAPL ?? []).length}</span>
      <span data-testid="last-update">{lastUpdate === 0 ? "never" : "seen"}</span>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;
const source = () => FakeEventSource.instances.at(-1)!;

function frame(price: number, timestamp: number, ticker = "AAPL") {
  return {
    [ticker]: {
      ticker,
      price,
      previous_price: price - 0.5,
      timestamp,
      change: 0.5,
      change_percent: 0.26,
      direction: "up",
    },
  };
}

let originalEventSource: unknown;

beforeEach(() => {
  FakeEventSource.instances = [];
  originalEventSource = (globalThis as Record<string, unknown>).EventSource;
  (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).EventSource = originalEventSource;
});

describe("usePriceStream", () => {
  it("opens exactly one relative-path connection", () => {
    render(<Probe />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source().url).toBe("/api/stream/prices");
    expect(source().url).not.toMatch(/^https?:|localhost|:8000/);
  });

  it("starts as connecting and goes green on open", () => {
    render(<Probe />);
    expect(text("status")).toBe("connecting");
    source().emitOpen();
    expect(text("status")).toBe("open");
  });

  it("merges streamed frames into the price map", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitData({ ...frame(190, 1_700_000_000), ...frame(410, 1_700_000_000, "MSFT") });

    expect(text("tickers")).toBe("AAPL,MSFT");
    expect(text("aapl")).toBe("190");
    expect(text("last-update")).toBe("seen");

    source().emitData(frame(191, 1_700_000_000.5));
    expect(text("aapl")).toBe("191");
  });

  it("accumulates a sparkline buffer and caps it at 120 points", () => {
    render(<Probe />);
    source().emitOpen();

    for (let i = 0; i < MAX_POINTS + 30; i += 1) {
      source().emitData(frame(190 + i * 0.01, 1_700_000_000 + i * 0.5));
    }

    expect(text("buffer")).toBe(String(MAX_POINTS));
  });

  it("does not double-store a repeated frame", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitData(frame(190, 1_700_000_000));
    source().emitData(frame(190, 1_700_000_000));
    expect(text("buffer")).toBe("1");
  });

  it("ignores malformed frames instead of tearing down the stream", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitData(frame(190, 1_700_000_000));

    source().emitData("not json");
    source().emitData("[]");

    expect(text("aapl")).toBe("190");
    expect(text("status")).toBe("open");
    expect(source().closed).toBe(false);
  });

  it("reports yellow (reconnecting) after a drop from an established stream", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitError(FakeEventSource.CONNECTING);
    expect(text("status")).toBe("reconnecting");

    source().emitOpen();
    expect(text("status")).toBe("open");
  });

  it("stays on connecting when the very first attempt is retrying", () => {
    render(<Probe />);
    source().emitError(FakeEventSource.CONNECTING);
    expect(text("status")).toBe("connecting");
  });

  it("reports red (closed) when the browser gives up", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitError(FakeEventSource.CLOSED);
    expect(text("status")).toBe("closed");
  });

  it("closes the connection on unmount", () => {
    const { unmount } = render(<Probe />);
    const stream = source();
    unmount();
    expect(stream.closed).toBe(true);
  });

  it("does nothing when EventSource is unavailable", () => {
    (globalThis as Record<string, unknown>).EventSource = undefined;
    expect(() => render(<Probe />)).not.toThrow();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(text("status")).toBe("connecting");
  });
});

describe("usePriceStream reconnection after a fatal close", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drive the retry timer while React is allowed to flush the state it sets. */
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("re-creates the connection a second after the browser gives up", () => {
    render(<Probe />);
    source().emitOpen();
    source().emitError(FakeEventSource.CLOSED);

    expect(text("status")).toBe("closed");
    expect(FakeEventSource.instances).toHaveLength(1);

    // Nothing before the backoff elapses.
    advance(999);
    expect(FakeEventSource.instances).toHaveLength(1);

    advance(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(source().url).toBe("/api/stream/prices");
    expect(text("status")).toBe("reconnecting");

    // The fresh source is fully wired: it streams like the original.
    source().emitOpen();
    source().emitData(frame(190, 1_700_000_000));
    expect(text("status")).toBe("open");
    expect(text("aapl")).toBe("190");
  });

  it("retries a first connection that dies before ever opening", () => {
    render(<Probe />);
    source().emitError(FakeEventSource.CLOSED);
    expect(text("status")).toBe("closed");

    advance(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    // Never connected, so this is still a first attempt, not a reconnect.
    expect(text("status")).toBe("connecting");
  });

  it("doubles the delay across repeated failures and caps it", () => {
    render(<Probe />);
    source().emitOpen();

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const before = FakeEventSource.instances.length;
      source().emitError(FakeEventSource.CLOSED);

      advance(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(before);

      advance(1);
      expect(FakeEventSource.instances).toHaveLength(before + 1);
    }
  });

  it("resets the backoff once a retry actually opens", () => {
    render(<Probe />);
    source().emitOpen();

    // Two failures in a row push the next delay out to 4s.
    source().emitError(FakeEventSource.CLOSED);
    advance(1_000);
    source().emitError(FakeEventSource.CLOSED);
    advance(2_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    source().emitOpen();
    expect(text("status")).toBe("open");

    // Back to the 1s base rather than 4s.
    source().emitError(FakeEventSource.CLOSED);
    advance(999);
    expect(FakeEventSource.instances).toHaveLength(3);
    advance(1);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("cancels a pending retry on unmount and opens nothing further", () => {
    const { unmount } = render(<Probe />);
    source().emitOpen();
    source().emitError(FakeEventSource.CLOSED);

    const stream = source();
    unmount();

    expect(stream.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    advance(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the dead source when the retry replaces it", () => {
    render(<Probe />);
    source().emitOpen();
    const dead = source();
    dead.emitError(FakeEventSource.CLOSED);

    advance(1_000);
    expect(dead.closed).toBe(true);
    expect(source()).not.toBe(dead);

    // A late error from the replaced source must not disturb the live one.
    act(() => dead.onerror?.(new Event("error")));
    expect(text("status")).toBe("reconnecting");
    expect(vi.getTimerCount()).toBe(0);
  });
});
