/**
 * Wire types. These mirror `planning/CONTRACTS.md` §6 exactly — do not widen or
 * rename fields here without a contract change.
 */

export type Direction = "up" | "down" | "flat";

/** One entry of the `/api/stream/prices` SSE payload map. */
export interface PriceTick {
  ticker: string;
  price: number;
  previous_price: number;
  /** Unix seconds as a float — this endpoint is frozen and does not send ISO. */
  timestamp: number;
  change: number;
  change_percent: number;
  direction: Direction;
}

export type PriceMap = Record<string, PriceTick>;

export interface HealthResponse {
  status: string;
  market_source: "simulator" | "massive";
  llm_mock: boolean;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  weight: number;
}

export interface PortfolioResponse {
  cash_balance: number;
  positions: Position[];
  positions_value: number;
  total_value: number;
  total_cost_basis: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_percent: number;
}

export interface Snapshot {
  total_value: number;
  recorded_at: string;
}

export interface HistoryResponse {
  snapshots: Snapshot[];
}

export interface WatchlistItem {
  ticker: string;
  added_at: string;
  price: number | null;
  previous_price: number | null;
  change: number;
  change_percent: number;
  direction: Direction;
}

export interface WatchlistResponse {
  tickers: WatchlistItem[];
}

export type TradeSide = "buy" | "sell";

export interface Trade {
  id: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  total: number;
  executed_at: string;
}

export interface TradeResponse {
  trade: Trade;
  cash_balance: number;
  position: Position | null;
  total_value: number;
}

export type ChatActionStatus = "executed" | "failed";

export interface ChatAction {
  type: "trade" | "watchlist";
  status: ChatActionStatus;
  ticker: string;
  detail: string;
  /** Trade actions only. */
  side?: TradeSide;
  quantity?: number;
  price?: number | null;
  /** Watchlist actions only. */
  action?: "add" | "remove";
}

export interface ChatResponse {
  id: string;
  message: string;
  actions: ChatAction[];
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: ChatAction[] | null;
  created_at: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

/** A single point in a client-side sparkline ring buffer. */
export interface PricePoint {
  /** Milliseconds since epoch (the SSE timestamp is seconds — convert once). */
  t: number;
  p: number;
}
