"""Chat endpoints: one LLM turn, its executed actions, and the transcript.

The turn follows ``planning/CONTRACTS.md`` §7 exactly: persist the user message,
build live context, load recent history, ask the assistant, execute whatever it
asked for, then persist and return the reply.

Trades and watchlist changes are never re-implemented here — they go through the
same service functions (and therefore the same validation) as a manual trade. A
rejected action is a normal outcome: it becomes a ``failed`` entry in ``actions``
and a note appended to the message, and the request still returns 200.
"""

from __future__ import annotations

import json
import logging
import sqlite3

from anyio import to_thread
from fastapi import APIRouter, HTTPException, Query
from pydantic import ValidationError

from app.config import DEFAULT_USER_ID
from app.db.database import ensure_db, get_connection, new_id, utc_now_iso, write_connection
from app.llm.client import LLMUnavailableError, generate_response
from app.llm.schemas import Trade, WatchlistChange
from app.schemas import (
    ChatAction,
    ChatHistoryResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
)
from app.services import portfolio as portfolio_service
from app.services import watchlist as watchlist_service
from app.services.portfolio import normalize_ticker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

#: How many past messages are replayed to the model (CONTRACTS.md §7 step 3).
CONTEXT_HISTORY_LIMIT = 20

DEFAULT_HISTORY_LIMIT = 50
MAX_HISTORY_LIMIT = 500


# --- Transcript persistence ---


def _row_to_message(row: sqlite3.Row) -> ChatMessage:
    """Map a ``chat_messages`` row, parsing the stored actions JSON."""
    raw = row["actions"]
    actions: list[ChatAction] | None = None
    if raw:
        try:
            actions = [ChatAction.model_validate(item) for item in json.loads(raw)]
        except (json.JSONDecodeError, ValidationError, TypeError):
            logger.warning("Unparseable actions on chat message %s", row["id"])
    return ChatMessage(
        id=row["id"],
        role=row["role"],
        content=row["content"],
        actions=actions,
        created_at=row["created_at"],
    )


def _insert_message(
    role: str,
    content: str,
    actions: list[ChatAction] | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> tuple[str, str]:
    """Append a message to the transcript. Returns its id and timestamp."""
    ensure_db()
    message_id = new_id()
    created_at = utc_now_iso()
    payload = (
        json.dumps([action.model_dump() for action in actions]) if actions is not None else None
    )

    with write_connection() as conn:
        conn.execute(
            """
            INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (message_id, user_id, role, content, payload, created_at),
        )
    return message_id, created_at


def _load_history(
    limit: int = DEFAULT_HISTORY_LIMIT,
    exclude_id: str | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> list[ChatMessage]:
    """The most recent ``limit`` messages, oldest first.

    ``exclude_id`` skips the turn's own user message, which has already been
    persisted by the time the model's history is assembled.
    """
    ensure_db()
    limit = max(1, min(int(limit), MAX_HISTORY_LIMIT))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, role, content, actions, created_at FROM chat_messages
            WHERE user_id = ? AND id IS NOT ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?
            """,
            (user_id, exclude_id, limit),
        ).fetchall()

    return [_row_to_message(row) for row in reversed(rows)]


# --- Action execution ---


def _format_quantity(quantity: float) -> str:
    """Render a share count without trailing zero noise."""
    return f"{quantity:.6f}".rstrip("0").rstrip(".") or "0"


async def _execute_trade(trade: Trade) -> ChatAction:
    """Run one requested trade through the portfolio service."""
    ticker = normalize_ticker(trade.ticker)
    try:
        result = await to_thread.run_sync(
            portfolio_service.execute_trade, ticker, trade.quantity, trade.side
        )
    except HTTPException as exc:
        return ChatAction(
            type="trade",
            status="failed",
            ticker=ticker,
            side=trade.side,
            quantity=trade.quantity,
            price=None,
            detail=str(exc.detail),
        )

    executed = result.trade
    verb = "Bought" if executed.side == "buy" else "Sold"
    return ChatAction(
        type="trade",
        status="executed",
        ticker=ticker,
        side=executed.side,
        quantity=executed.quantity,
        price=executed.price,
        detail=(
            f"{verb} {_format_quantity(executed.quantity)} {ticker} "
            f"@ ${executed.price:,.2f}"
        ),
    )


async def _apply_watchlist_change(change: WatchlistChange) -> ChatAction:
    """Run one requested watchlist mutation through the watchlist service."""
    ticker = normalize_ticker(change.ticker)
    try:
        if change.action == "add":
            await watchlist_service.add_ticker(ticker)
            detail = f"Added {ticker} to the watchlist"
        else:
            await watchlist_service.remove_ticker(ticker)
            detail = f"Removed {ticker} from the watchlist"
    except HTTPException as exc:
        return ChatAction(
            type="watchlist",
            status="failed",
            ticker=ticker,
            action=change.action,
            detail=str(exc.detail),
        )

    return ChatAction(
        type="watchlist",
        status="executed",
        ticker=ticker,
        action=change.action,
        detail=detail,
    )


def _failure_note(failures: list[ChatAction]) -> str:
    """A short plain-language addendum describing what did not go through."""
    if len(failures) == 1:
        return f"\n\nHeads up: I could not complete that action — {failures[0].detail}."
    joined = "; ".join(action.detail for action in failures)
    return f"\n\nHeads up: {len(failures)} actions could not be completed — {joined}."


# --- Endpoints ---


@router.post("", response_model=ChatResponse)
async def create_chat_message(request: ChatRequest) -> ChatResponse:
    """Send a message to the assistant; any trades it asks for execute immediately."""
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    user_message_id, _ = await to_thread.run_sync(_insert_message, "user", message)

    portfolio = await to_thread.run_sync(portfolio_service.get_portfolio)
    watchlist = await watchlist_service.get_watchlist()
    history = await to_thread.run_sync(
        _load_history, CONTEXT_HISTORY_LIMIT, user_message_id
    )

    try:
        reply = await generate_response(message, portfolio, watchlist, history)
    except LLMUnavailableError as exc:
        raise HTTPException(
            status_code=503, detail=f"AI assistant is unavailable: {exc}"
        ) from exc

    actions = [await _execute_trade(trade) for trade in reply.trades]
    actions += [await _apply_watchlist_change(change) for change in reply.watchlist_changes]

    text = reply.message
    failures = [action for action in actions if action.status == "failed"]
    if failures:
        text += _failure_note(failures)

    message_id, created_at = await to_thread.run_sync(
        _insert_message, "assistant", text, actions
    )
    return ChatResponse(id=message_id, message=text, actions=actions, created_at=created_at)


@router.get("/history", response_model=ChatHistoryResponse)
async def read_chat_history(
    limit: int = Query(
        DEFAULT_HISTORY_LIMIT,
        ge=1,
        le=MAX_HISTORY_LIMIT,
        description="Number of most recent messages to return, oldest first.",
    ),
) -> ChatHistoryResponse:
    """The conversation transcript, ascending by ``created_at``."""
    messages = await to_thread.run_sync(_load_history, limit)
    return ChatHistoryResponse(messages=messages)
