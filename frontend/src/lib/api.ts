/**
 * Thin fetch wrapper over the FastAPI backend.
 *
 * Every path is same-origin and relative (contract §8). `NEXT_PUBLIC_API_BASE`
 * exists only as an escape hatch for unusual dev setups and defaults to "", so
 * the static export always emits relative URLs.
 */

import type {
  ChatHistoryResponse,
  ChatResponse,
  HealthResponse,
  HistoryResponse,
  PortfolioResponse,
  TradeResponse,
  TradeSide,
  WatchlistItem,
  WatchlistResponse,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** An error carrying the backend's `{"detail": "..."}` message and status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError("Cannot reach the server", 0);
  }

  if (!response.ok) {
    throw new ApiError(await readDetail(response), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * FastAPI renders errors as `{"detail": "..."}`, but `detail` is an array of
 * objects for 422 validation errors, and a proxy may return HTML entirely.
 */
async function readDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown })?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  } catch {
    /* fall through to the generic message */
  }
  return `Request failed (${response.status})`;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),

  portfolio: () => request<PortfolioResponse>("/api/portfolio"),

  history: (limit = 500) => request<HistoryResponse>(`/api/portfolio/history?limit=${limit}`),

  trade: (ticker: string, quantity: number, side: TradeSide) =>
    request<TradeResponse>("/api/portfolio/trade", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity, side }),
    }),

  watchlist: () => request<WatchlistResponse>("/api/watchlist"),

  addTicker: (ticker: string) =>
    request<WatchlistItem>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ ticker }),
    }),

  removeTicker: (ticker: string) =>
    request<void>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" }),

  chat: (message: string) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  chatHistory: (limit = 50) =>
    request<ChatHistoryResponse>(`/api/chat/history?limit=${limit}`),
};
