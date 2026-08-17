"""Tests for application wiring: lifespan, health, SPA fallback and /api 404s."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import runtime
from app.main import app, create_app
from app.market.seed_prices import SEED_PRICES


@pytest.fixture
def live_client(temp_db, price_cache):
    """The real app with its lifespan running: DB seeded, simulator streaming."""
    with TestClient(app) as client:
        yield client
    runtime.set_market_source(None)


def test_health(live_client):
    response = live_client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "market_source": "simulator", "llm_mock": False}


def test_health_reports_llm_mock(live_client, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    assert live_client.get("/api/health").json()["llm_mock"] is True


def test_lifespan_starts_the_feed_on_the_watchlist(live_client):
    source = runtime.get_market_source()
    assert set(source.get_tickers()) == set(SEED_PRICES)
    assert set(runtime.get_price_cache().get_all()) == set(SEED_PRICES)


def test_lifespan_records_a_boot_snapshot(live_client):
    assert len(live_client.get("/api/portfolio/history").json()["snapshots"]) == 1


def test_watchlist_add_starts_streaming_the_new_ticker(live_client):
    assert live_client.post("/api/watchlist", json={"ticker": "PYPL"}).status_code == 201
    assert "PYPL" in runtime.get_market_source().get_tickers()
    assert runtime.get_price_cache().get_price("PYPL") is not None


def test_sse_stream_route_is_registered_exactly_once():
    """Streaming itself is covered by tests/market/; here we only check wiring.

    (The endpoint is an unbounded generator, so requesting it from TestClient would
    never return.)
    """
    paths = [route.path for route in app.routes if getattr(route, "path", None)]
    assert paths.count("/api/stream/prices") == 1


def test_unknown_api_path_is_404(live_client):
    assert live_client.get("/api/nope").status_code == 404


def test_boots_without_a_static_directory(temp_db, tmp_path, monkeypatch):
    """The frontend build may not exist yet — that must not crash the backend."""
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "does-not-exist"))
    with TestClient(create_app()) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/some/spa/route").status_code == 404
    runtime.set_market_source(None)


def test_spa_fallback_serves_index_html(temp_db, tmp_path, monkeypatch):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html><title>FinAlly</title>")
    (static_dir / "favicon.ico").write_bytes(b"icon")
    monkeypatch.setenv("STATIC_DIR", str(static_dir))

    with TestClient(create_app()) as client:
        assert client.get("/").text.startswith("<!doctype html>")
        # Unknown non-/api path falls back to the SPA entry point...
        assert client.get("/portfolio/deep/link").text.startswith("<!doctype html>")
        # ...but a real asset is served as itself, and unknown /api paths still 404.
        assert client.get("/favicon.ico").content == b"icon"
        assert client.get("/api/nope").status_code == 404
    runtime.set_market_source(None)


def test_spa_fallback_wins_over_a_404_html(temp_db, tmp_path, monkeypatch):
    """The Next.js export ships a 404.html, which html mode returns instead of raising."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html><title>FinAlly</title>")
    (static_dir / "404.html").write_text("<!doctype html><title>Not found</title>")
    monkeypatch.setenv("STATIC_DIR", str(static_dir))

    with TestClient(create_app()) as client:
        assert client.get("/").text.startswith("<!doctype html><title>FinAlly")

        deep = client.get("/portfolio/deep/link")
        assert deep.status_code == 200
        assert deep.text.startswith("<!doctype html><title>FinAlly")

        # An unknown /api path keeps a bare 404 - never the 404.html page.
        missing_api = client.get("/api/nope")
        assert missing_api.status_code == 404
        assert "Not found</title>" not in missing_api.text
    runtime.set_market_source(None)
