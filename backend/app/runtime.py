"""Process-wide singletons shared by the API, services and the chat flow.

The price cache is created lazily on first use so that services can read live
prices without threading a FastAPI dependency through every call site. The market
data source is owned by the FastAPI lifespan in :mod:`app.main`, which registers
it here via :func:`set_market_source`.
"""

from __future__ import annotations

from app.market import MarketDataSource, PriceCache

_price_cache: PriceCache | None = None
_market_source: MarketDataSource | None = None


def get_price_cache() -> PriceCache:
    """Return the process-wide :class:`PriceCache`, creating it on first call."""
    global _price_cache
    if _price_cache is None:
        _price_cache = PriceCache()
    return _price_cache


def get_market_source() -> MarketDataSource:
    """Return the running market data source.

    Raises:
        RuntimeError: if the source has not been started yet (e.g. outside the
            FastAPI lifespan). Callers that can tolerate this — such as watchlist
            mutation in unit tests — should catch it.
    """
    if _market_source is None:
        raise RuntimeError("Market data source has not been started")
    return _market_source


def set_market_source(source: MarketDataSource | None) -> None:
    """Register (or clear, with ``None``) the running market data source."""
    global _market_source
    _market_source = source


def reset_runtime() -> None:
    """Drop both singletons. Intended for shutdown and test isolation."""
    global _price_cache, _market_source
    _price_cache = None
    _market_source = None
