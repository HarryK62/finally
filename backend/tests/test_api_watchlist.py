"""HTTP-level tests for the watchlist endpoints."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import runtime
from app.api import watchlist as watchlist_router
from app.market.seed_prices import SEED_PRICES
from tests.test_services_watchlist import FakeSource


@pytest.fixture
def client(temp_db, price_cache):
    runtime.set_market_source(FakeSource())
    app = FastAPI()
    app.include_router(watchlist_router.router)
    with TestClient(app) as test_client:
        yield test_client
    runtime.set_market_source(None)


def test_get_watchlist_returns_the_seeded_tickers(client):
    response = client.get("/api/watchlist")
    assert response.status_code == 200
    tickers = response.json()["tickers"]
    assert [item["ticker"] for item in tickers] == list(SEED_PRICES)
    assert set(tickers[0]) == {
        "ticker",
        "added_at",
        "price",
        "previous_price",
        "change",
        "change_percent",
        "direction",
    }


def test_add_ticker_returns_201(client):
    response = client.post("/api/watchlist", json={"ticker": "pypl"})
    assert response.status_code == 201
    assert response.json()["ticker"] == "PYPL"
    assert response.json()["direction"] == "flat"
    assert "PYPL" in [i["ticker"] for i in client.get("/api/watchlist").json()["tickers"]]


def test_add_duplicate_is_409(client):
    response = client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert response.status_code == 409
    assert response.json() == {"detail": "AAPL is already in the watchlist"}


def test_add_invalid_symbol_is_400(client):
    response = client.post("/api/watchlist", json={"ticker": "not a ticker"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid ticker symbol"}


def test_delete_ticker_is_204_with_empty_body(client):
    response = client.delete("/api/watchlist/AAPL")
    assert response.status_code == 204
    assert response.content == b""
    assert "AAPL" not in [i["ticker"] for i in client.get("/api/watchlist").json()["tickers"]]


def test_delete_is_case_insensitive(client):
    assert client.delete("/api/watchlist/aapl").status_code == 204


def test_delete_missing_ticker_is_404(client):
    response = client.delete("/api/watchlist/PYPL")
    assert response.status_code == 404
    assert response.json() == {"detail": "PYPL is not in the watchlist"}


def test_prices_appear_once_cached(client, price_cache):
    price_cache.update("AAPL", 190.0)
    price_cache.update("AAPL", 191.0)

    item = next(i for i in client.get("/api/watchlist").json()["tickers"] if i["ticker"] == "AAPL")
    assert item["price"] == 191.0
    assert item["previous_price"] == 190.0
    assert item["direction"] == "up"
    assert item["change"] == 1.0
