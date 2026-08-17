"""Portfolio valuation, trade execution and value history.

Live prices come from the shared :class:`~app.market.PriceCache` via
:mod:`app.runtime`; nothing here talks to a market data source directly.

All functions are synchronous and blocking — API routers hand them to a worker
thread so the event loop is never blocked by SQLite.
"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import HTTPException

from app.config import DEFAULT_USER_ID
from app.db.database import (
    ensure_db,
    get_connection,
    new_id,
    utc_now_iso,
    write_connection,
)
from app.runtime import get_price_cache
from app.schemas import (
    HistoryResponse,
    PortfolioResponse,
    Position,
    Snapshot,
    TradeRecord,
    TradeResponse,
)

logger = logging.getLogger(__name__)

# Quantities below this are treated as zero (float noise from repeated buys/sells).
QUANTITY_EPSILON = 1e-9

DEFAULT_HISTORY_LIMIT = 500
MAX_HISTORY_LIMIT = 5000


# --- Helpers ---


def normalize_ticker(ticker: str) -> str:
    """Uppercase and strip a ticker. Applied at every entry point."""
    return ticker.strip().upper()


def _format_quantity(quantity: float) -> str:
    """Render a quantity for error messages without trailing zero noise."""
    return f"{quantity:.6f}".rstrip("0").rstrip(".") or "0"


def api_round(value: float, places: int) -> float:
    """Round at the API boundary, collapsing ``-0.0`` so JSON never carries it.

    A tiny downtick rounds to ``-0.0``, which serializes as ``-0.0`` and renders
    as "-0.00%" in the UI. Adding ``0.0`` normalizes it without touching real
    negatives (IEEE-754: ``-0.0 + 0.0 == 0.0``, ``-0.5 + 0.0 == -0.5``).
    """
    return round(value, places) + 0.0


def _build_position(ticker: str, quantity: float, avg_cost: float, price: float | None,
                    positions_value: float) -> Position:
    """Value one holding. Falls back to ``avg_cost`` when no price is cached."""
    current_price = price if price is not None else avg_cost
    market_value = quantity * current_price
    cost_basis = quantity * avg_cost
    pnl = market_value - cost_basis
    pnl_percent = (pnl / cost_basis * 100) if cost_basis else 0.0
    weight = (market_value / positions_value) if positions_value else 0.0

    return Position(
        ticker=ticker,
        quantity=api_round(quantity, 6),
        avg_cost=api_round(avg_cost, 2),
        current_price=api_round(current_price, 2),
        market_value=api_round(market_value, 2),
        cost_basis=api_round(cost_basis, 2),
        unrealized_pnl=api_round(pnl, 2),
        unrealized_pnl_percent=api_round(pnl_percent, 2),
        weight=api_round(weight, 4),
    )


def _fetch_cash(conn: sqlite3.Connection, user_id: str) -> float:
    """Read the cash balance, raising 404 if the profile row is missing."""
    row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No profile found for user {user_id}")
    return float(row["cash_balance"])


# --- Public API ---


def get_portfolio(user_id: str = DEFAULT_USER_ID) -> PortfolioResponse:
    """Current cash, holdings valued at live prices, and aggregate P&L."""
    ensure_db()
    with get_connection() as conn:
        cash = _fetch_cash(conn, user_id)
        rows = conn.execute(
            "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?",
            (user_id,),
        ).fetchall()

    cache = get_price_cache()
    holdings = [
        (row["ticker"], float(row["quantity"]), float(row["avg_cost"]),
         cache.get_price(row["ticker"]))
        for row in rows
    ]

    positions_value = sum(
        quantity * (price if price is not None else avg_cost)
        for _, quantity, avg_cost, price in holdings
    )
    total_cost_basis = sum(quantity * avg_cost for _, quantity, avg_cost, _ in holdings)
    total_pnl = positions_value - total_cost_basis
    total_pnl_percent = (total_pnl / total_cost_basis * 100) if total_cost_basis else 0.0

    positions = [
        _build_position(ticker, quantity, avg_cost, price, positions_value)
        for ticker, quantity, avg_cost, price in holdings
    ]
    positions.sort(key=lambda position: position.market_value, reverse=True)

    return PortfolioResponse(
        cash_balance=api_round(cash, 2),
        positions=positions,
        positions_value=api_round(positions_value, 2),
        total_value=api_round(cash + positions_value, 2),
        total_cost_basis=api_round(total_cost_basis, 2),
        total_unrealized_pnl=api_round(total_pnl, 2),
        total_unrealized_pnl_percent=api_round(total_pnl_percent, 2),
    )


def execute_trade(
    ticker: str,
    quantity: float,
    side: str,
    user_id: str = DEFAULT_USER_ID,
) -> TradeResponse:
    """Execute a market order at the latest cached price.

    Buys check cash, sells check held shares; both update the position and cash in
    a single transaction, append to ``trades`` and then record a snapshot.

    Raises:
        HTTPException: 400 for any validation failure (see CONTRACTS.md §5).
    """
    ensure_db()
    ticker = normalize_ticker(ticker)

    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")

    side = side.strip().lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="Side must be 'buy' or 'sell'")

    price = get_price_cache().get_price(ticker)
    if price is None:
        raise HTTPException(status_code=400, detail=f"No price available for {ticker}")

    total = round(quantity * price, 2)
    now = utc_now_iso()
    trade_id = new_id()

    with write_connection() as conn:
        cash = _fetch_cash(conn, user_id)
        row = conn.execute(
            "SELECT id, quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        ).fetchone()
        held_quantity = float(row["quantity"]) if row else 0.0
        held_avg_cost = float(row["avg_cost"]) if row else 0.0

        if side == "buy":
            if total > cash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient cash: need ${total:.2f}, have ${cash:.2f}",
                )
            new_quantity = held_quantity + quantity
            new_avg_cost = (held_quantity * held_avg_cost + quantity * price) / new_quantity
            new_cash = cash - total
        else:
            if quantity > held_quantity + QUANTITY_EPSILON:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Insufficient shares: trying to sell {_format_quantity(quantity)}, "
                        f"hold {_format_quantity(held_quantity)}"
                    ),
                )
            new_quantity = held_quantity - quantity
            new_avg_cost = held_avg_cost  # A sell never changes average cost
            new_cash = cash + total

        if new_quantity <= QUANTITY_EPSILON:
            conn.execute(
                "DELETE FROM positions WHERE user_id = ? AND ticker = ?", (user_id, ticker)
            )
        else:
            conn.execute(
                """
                INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, ticker) DO UPDATE SET
                    quantity = excluded.quantity,
                    avg_cost = excluded.avg_cost,
                    updated_at = excluded.updated_at
                """,
                (new_id(), user_id, ticker, new_quantity, new_avg_cost, now),
            )

        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?", (new_cash, user_id)
        )
        conn.execute(
            """
            INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (trade_id, user_id, ticker, side, quantity, price, now),
        )

    portfolio = get_portfolio(user_id)
    record_snapshot(user_id, total_value=portfolio.total_value)

    position = next((p for p in portfolio.positions if p.ticker == ticker), None)
    logger.info(
        "Trade executed: %s %s %s @ %.2f", side, _format_quantity(quantity), ticker, price
    )

    return TradeResponse(
        trade=TradeRecord(
            id=trade_id,
            ticker=ticker,
            side=side,
            quantity=api_round(quantity, 6),
            price=api_round(price, 2),
            total=total,
            executed_at=now,
        ),
        cash_balance=portfolio.cash_balance,
        position=position,
        total_value=portfolio.total_value,
    )


def get_history(
    limit: int = DEFAULT_HISTORY_LIMIT,
    user_id: str = DEFAULT_USER_ID,
) -> HistoryResponse:
    """The most recent ``limit`` portfolio snapshots, oldest first (chart-ready)."""
    ensure_db()
    limit = max(1, min(int(limit), MAX_HISTORY_LIMIT))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT total_value, recorded_at FROM portfolio_snapshots
            WHERE user_id = ?
            ORDER BY recorded_at DESC, rowid DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()

    snapshots = [
        Snapshot(
            total_value=api_round(float(row["total_value"]), 2),
            recorded_at=row["recorded_at"],
        )
        for row in reversed(rows)
    ]
    return HistoryResponse(snapshots=snapshots)


def record_snapshot(user_id: str = DEFAULT_USER_ID, total_value: float | None = None) -> None:
    """Append the current total portfolio value to ``portfolio_snapshots``.

    Pass ``total_value`` to reuse an already-computed portfolio and skip a re-read.
    """
    ensure_db()
    if total_value is None:
        total_value = get_portfolio(user_id).total_value

    with write_connection() as conn:
        conn.execute(
            """
            INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at)
            VALUES (?, ?, ?, ?)
            """,
            (new_id(), user_id, total_value, utc_now_iso()),
        )
