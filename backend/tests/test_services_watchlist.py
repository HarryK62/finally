"""Tests for watchlist CRUD and market data source synchronization."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import runtime
from app.market import MarketDataSource
from app.market.seed_prices import SEED_PRICES
from app.services import watchlist as svc


class FakeSource(MarketDataSource):
    """Records add/remove calls so tests can assert the feed stays in sync."""

    def __init__(self) -> None:
        self.tickers: list[str] = []
        self.added: list[str] = []
        self.removed: list[str] = []

    async def start(self, tickers: list[str]) -> None:
        self.tickers = list(tickers)

    async def stop(self) -> None:
        self.tickers = []

    async def add_ticker(self, ticker: str) -> None:
        self.added.append(ticker)
        self.tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.removed.append(ticker)
        if ticker in self.tickers:
            self.tickers.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self.tickers)


@pytest.fixture
def fake_source(price_cache):
    source = FakeSource()
    runtime.set_market_source(source)
    yield source
    runtime.set_market_source(None)


async def test_default_watchlist_is_returned_in_insertion_order(temp_db, price_cache):
    result = await svc.get_watchlist()
    assert [item.ticker for item in result.tickers] == list(SEED_PRICES)


async def test_items_without_a_cached_price_are_flat(temp_db, price_cache):
    item = (await svc.get_watchlist()).tickers[0]
    assert item.price is None
    assert item.previous_price is None
    assert item.change == 0.0
    assert item.change_percent == 0.0
    assert item.direction == "flat"


async def test_items_carry_the_cached_price_and_direction(temp_db, price_cache):
    price_cache.update("AAPL", 190.00)
    price_cache.update("AAPL", 195.00)

    item = next(i for i in (await svc.get_watchlist()).tickers if i.ticker == "AAPL")
    assert item.price == pytest.approx(195.0)
    assert item.previous_price == pytest.approx(190.0)
    assert item.change == pytest.approx(5.0)
    assert item.change_percent == pytest.approx(2.63)
    assert item.direction == "up"


async def test_add_ticker_normalizes_and_syncs_the_feed(temp_db, fake_source):
    item = await svc.add_ticker("  pypl ")

    assert item.ticker == "PYPL"
    assert fake_source.added == ["PYPL"]
    assert "PYPL" in [i.ticker for i in (await svc.get_watchlist()).tickers]


async def test_add_duplicate_conflicts(temp_db, fake_source):
    with pytest.raises(HTTPException) as exc:
        await svc.add_ticker("aapl")
    assert exc.value.status_code == 409
    assert exc.value.detail == "AAPL is already in the watchlist"
    assert fake_source.added == []


@pytest.mark.parametrize("ticker", ["", "   ", "TOOLONGTICKER", "AA PL", "AA1", "$$$"])
async def test_invalid_symbols_are_rejected(temp_db, fake_source, ticker):
    with pytest.raises(HTTPException) as exc:
        await svc.add_ticker(ticker)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid ticker symbol"


async def test_remove_ticker_syncs_the_feed(temp_db, fake_source):
    await svc.remove_ticker("aapl")

    assert fake_source.removed == ["AAPL"]
    assert "AAPL" not in [i.ticker for i in (await svc.get_watchlist()).tickers]


async def test_remove_missing_ticker_is_404(temp_db, fake_source):
    with pytest.raises(HTTPException) as exc:
        await svc.remove_ticker("pypl")
    assert exc.value.status_code == 404
    assert exc.value.detail == "PYPL is not in the watchlist"


async def test_mutations_work_without_a_running_market_source(temp_db, price_cache):
    """Unit tests and requests racing startup must not blow up on a missing source."""
    runtime.set_market_source(None)
    item = await svc.add_ticker("PYPL")
    assert item.ticker == "PYPL"
    await svc.remove_ticker("PYPL")


def test_get_watchlist_tickers_helper(temp_db):
    assert svc.get_watchlist_tickers() == list(SEED_PRICES)
