"""Watchlist endpoints. Mutations also start/stop the live price feed."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.schemas import WatchlistAddRequest, WatchlistItem, WatchlistResponse
from app.services import watchlist as watchlist_service

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("", response_model=WatchlistResponse)
async def read_watchlist() -> WatchlistResponse:
    """Watched tickers with their latest prices, oldest first."""
    return await watchlist_service.get_watchlist()


@router.post("", response_model=WatchlistItem, status_code=status.HTTP_201_CREATED)
async def create_watchlist_entry(request: WatchlistAddRequest) -> WatchlistItem:
    """Add a ticker and begin streaming prices for it."""
    return await watchlist_service.add_ticker(request.ticker)


@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist_entry(ticker: str) -> Response:
    """Remove a ticker and stop streaming prices for it."""
    await watchlist_service.remove_ticker(ticker)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
