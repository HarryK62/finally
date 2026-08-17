"""All Pydantic request/response models for the FinAlly HTTP API.

Shapes are fixed by ``planning/CONTRACTS.md`` §6 — field names and nesting must not
change without updating that contract first. Values arrive here already rounded by
the service layer (money and percentages 2 dp, quantities 6 dp, weights 4 dp).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Side = Literal["buy", "sell"]
Direction = Literal["up", "down", "flat"]


# --- System ---


class HealthResponse(BaseModel):
    """``GET /api/health``."""

    status: str = "ok"
    market_source: Literal["simulator", "massive"]
    llm_mock: bool


# --- Portfolio ---


class Position(BaseModel):
    """A single holding, valued at the latest cached price."""

    ticker: str
    quantity: float
    avg_cost: float
    current_price: float
    market_value: float
    cost_basis: float
    unrealized_pnl: float
    unrealized_pnl_percent: float
    weight: float


class PortfolioResponse(BaseModel):
    """``GET /api/portfolio``."""

    cash_balance: float
    positions: list[Position]
    positions_value: float
    total_value: float
    total_cost_basis: float
    total_unrealized_pnl: float
    total_unrealized_pnl_percent: float


class TradeRequest(BaseModel):
    """``POST /api/portfolio/trade`` request body."""

    ticker: str
    quantity: float
    side: str


class TradeRecord(BaseModel):
    """The executed trade, as written to the ``trades`` table."""

    id: str
    ticker: str
    side: Side
    quantity: float
    price: float
    total: float
    executed_at: str


class TradeResponse(BaseModel):
    """``POST /api/portfolio/trade`` response."""

    trade: TradeRecord
    cash_balance: float
    position: Position | None
    total_value: float


class Snapshot(BaseModel):
    """One point on the portfolio value chart."""

    total_value: float
    recorded_at: str


class HistoryResponse(BaseModel):
    """``GET /api/portfolio/history`` — ascending by ``recorded_at``."""

    snapshots: list[Snapshot]


# --- Watchlist ---


class WatchlistItem(BaseModel):
    """A watched ticker with its latest cached price, if any."""

    ticker: str
    added_at: str
    price: float | None
    previous_price: float | None
    change: float
    change_percent: float
    direction: Direction


class WatchlistResponse(BaseModel):
    """``GET /api/watchlist`` — ascending by ``added_at``."""

    tickers: list[WatchlistItem]


class WatchlistAddRequest(BaseModel):
    """``POST /api/watchlist`` request body."""

    ticker: str


# --- Chat (consumed by app/api/chat.py, owned by the AI engineer) ---


class ChatRequest(BaseModel):
    """``POST /api/chat`` request body."""

    message: str


class ChatAction(BaseModel):
    """One trade or watchlist mutation attempted on behalf of the assistant.

    ``ticker``/``side``/``quantity``/``price`` are populated for trades (``price``
    is ``None`` when the trade failed); ``ticker``/``action`` for watchlist changes.
    """

    type: Literal["trade", "watchlist"]
    status: Literal["executed", "failed"]
    ticker: str
    detail: str
    side: Side | None = None
    quantity: float | None = None
    price: float | None = None
    action: Literal["add", "remove"] | None = None


class ChatResponse(BaseModel):
    """``POST /api/chat`` response."""

    id: str
    message: str
    actions: list[ChatAction] = Field(default_factory=list)
    created_at: str


class ChatMessage(BaseModel):
    """One persisted row from ``chat_messages``."""

    id: str
    role: Literal["user", "assistant"]
    content: str
    actions: list[ChatAction] | None = None
    created_at: str


class ChatHistoryResponse(BaseModel):
    """``GET /api/chat/history`` — ascending by ``created_at``."""

    messages: list[ChatMessage]
