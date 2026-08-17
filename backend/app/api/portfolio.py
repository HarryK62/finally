"""Portfolio endpoints: valuation, trade execution and value history.

The service layer is synchronous and hits SQLite, so every call is handed to a
worker thread to keep the event loop free for SSE streaming.
"""

from __future__ import annotations

from anyio import to_thread
from fastapi import APIRouter, Query

from app.schemas import HistoryResponse, PortfolioResponse, TradeRequest, TradeResponse
from app.services import portfolio as portfolio_service

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("", response_model=PortfolioResponse)
async def read_portfolio() -> PortfolioResponse:
    """Cash, positions valued at live prices, and aggregate unrealized P&L."""
    return await to_thread.run_sync(portfolio_service.get_portfolio)


@router.post("/trade", response_model=TradeResponse)
async def create_trade(request: TradeRequest) -> TradeResponse:
    """Execute a market order at the latest cached price. Instant fill, no fees."""
    return await to_thread.run_sync(
        portfolio_service.execute_trade, request.ticker, request.quantity, request.side
    )


@router.get("/history", response_model=HistoryResponse)
async def read_history(
    limit: int = Query(
        portfolio_service.DEFAULT_HISTORY_LIMIT,
        ge=1,
        le=portfolio_service.MAX_HISTORY_LIMIT,
        description="Number of most recent snapshots to return, oldest first.",
    ),
) -> HistoryResponse:
    """Portfolio value snapshots over time, ascending by timestamp."""
    return await to_thread.run_sync(portfolio_service.get_history, limit)
