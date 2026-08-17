"""HTTP-level tests for the chat endpoints, running against the mock assistant.

``LLM_MOCK=true`` throughout, so the whole turn — context, execution, persistence
— is exercised without a network call or an API key.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import runtime
from app.api import chat as chat_api
from app.llm.client import LLMUnavailableError
from app.services import portfolio as portfolio_service
from tests.test_services_watchlist import FakeSource


@pytest.fixture
def client(temp_db, seeded_prices, monkeypatch):
    """Chat router only, with mock LLM, seeded prices and a fake price feed."""
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    runtime.set_market_source(FakeSource())

    app = FastAPI()
    app.include_router(chat_api.router)
    with TestClient(app) as test_client:
        yield test_client
    runtime.set_market_source(None)


def _post(client: TestClient, message: str) -> dict:
    response = client.post("/api/chat", json={"message": message})
    assert response.status_code == 200, response.text
    return response.json()


# --- Plain conversation ---


def test_a_plain_question_returns_a_message_and_no_actions(client):
    body = _post(client, "how is my portfolio doing?")
    assert set(body) == {"id", "message", "actions", "created_at"}
    assert body["message"].startswith("[mock]")
    assert body["actions"] == []
    assert "$10,000.00" in body["message"]
    assert body["created_at"].endswith("Z")


def test_an_empty_message_is_400(client):
    response = client.post("/api/chat", json={"message": "   "})
    assert response.status_code == 400
    assert response.json() == {"detail": "Message cannot be empty"}


def test_an_upstream_failure_is_503(client, monkeypatch):
    async def unavailable(*args, **kwargs):
        raise LLMUnavailableError("openrouter is down")

    monkeypatch.setattr(chat_api, "generate_response", unavailable)

    response = client.post("/api/chat", json={"message": "hello"})
    assert response.status_code == 503
    assert response.json() == {"detail": "AI assistant is unavailable: openrouter is down"}


# --- Trade execution ---


def test_a_buy_executes_through_the_portfolio_service(client):
    body = _post(client, "buy 5 AAPL")

    assert body["actions"] == [
        {
            "type": "trade",
            "status": "executed",
            "ticker": "AAPL",
            "detail": "Bought 5 AAPL @ $190.00",
            "side": "buy",
            "quantity": 5.0,
            "price": 190.0,
            "action": None,
        }
    ]
    portfolio = portfolio_service.get_portfolio()
    assert portfolio.cash_balance == 9050.0
    assert portfolio.positions[0].ticker == "AAPL"
    assert portfolio.positions[0].quantity == 5.0


def test_a_sell_of_shares_not_held_fails_without_failing_the_request(client):
    body = _post(client, "sell 5 AAPL")

    action = body["actions"][0]
    assert action["status"] == "failed"
    assert action["price"] is None
    assert action["detail"] == "Insufficient shares: trying to sell 5, hold 0"
    assert "Heads up" in body["message"]
    assert "Insufficient shares" in body["message"]
    assert portfolio_service.get_portfolio().cash_balance == 10000.0


def test_a_buy_without_a_cached_price_fails_cleanly(client):
    body = _post(client, "buy 1 ZZZZ")

    assert body["actions"][0]["status"] == "failed"
    assert body["actions"][0]["detail"] == "No price available for ZZZZ"


def test_a_buy_beyond_the_cash_balance_fails_cleanly(client):
    body = _post(client, "buy 100 MSFT")

    assert body["actions"][0]["status"] == "failed"
    assert body["actions"][0]["detail"].startswith("Insufficient cash")


# --- Watchlist changes ---


def test_a_watchlist_add_executes_through_the_watchlist_service(client):
    body = _post(client, "add PYPL to my watchlist")

    assert body["actions"] == [
        {
            "type": "watchlist",
            "status": "executed",
            "ticker": "PYPL",
            "detail": "Added PYPL to the watchlist",
            "side": None,
            "quantity": None,
            "price": None,
            "action": "add",
        }
    ]
    assert "PYPL" in runtime.get_market_source().get_tickers()


def test_a_duplicate_watchlist_add_fails_without_failing_the_request(client):
    body = _post(client, "add AAPL")

    assert body["actions"][0]["status"] == "failed"
    assert body["actions"][0]["detail"] == "AAPL is already in the watchlist"
    assert "Heads up" in body["message"]


def test_a_watchlist_remove_executes(client):
    body = _post(client, "remove NFLX")

    assert body["actions"][0] == {
        "type": "watchlist",
        "status": "executed",
        "ticker": "NFLX",
        "detail": "Removed NFLX from the watchlist",
        "side": None,
        "quantity": None,
        "price": None,
        "action": "remove",
    }


def test_removing_an_unwatched_ticker_fails_cleanly(client):
    body = _post(client, "remove PYPL")

    assert body["actions"][0]["status"] == "failed"
    assert body["actions"][0]["detail"] == "PYPL is not in the watchlist"


# --- Transcript ---


def test_history_records_both_roles_oldest_first(client):
    _post(client, "hello there")
    _post(client, "buy 5 AAPL")

    messages = client.get("/api/chat/history").json()["messages"]
    assert [message["role"] for message in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert [message["content"] for message in messages][::2] == ["hello there", "buy 5 AAPL"]
    assert messages[0]["actions"] is None
    assert messages[1]["actions"] == []
    assert messages[3]["actions"][0]["ticker"] == "AAPL"
    assert messages[0]["created_at"] <= messages[-1]["created_at"]


def test_history_respects_the_limit_and_keeps_the_most_recent(client):
    _post(client, "first question")
    _post(client, "second question")

    messages = client.get("/api/chat/history?limit=2").json()["messages"]
    assert len(messages) == 2
    assert messages[0]["content"] == "second question"
    assert messages[1]["role"] == "assistant"


def test_history_rejects_an_out_of_range_limit(client):
    assert client.get("/api/chat/history?limit=0").status_code == 422


def test_the_stored_message_is_the_one_returned_including_the_failure_note(client):
    body = _post(client, "sell 5 AAPL")

    messages = client.get("/api/chat/history").json()["messages"]
    assert messages[-1]["content"] == body["message"]
    assert messages[-1]["actions"][0]["status"] == "failed"


# --- History windowing ---


def test_only_the_last_20_messages_are_replayed_to_the_model(client, monkeypatch):
    for index in range(30):
        chat_api._insert_message("user", f"message {index}")

    captured: list[list] = []

    async def capture(message, portfolio, watchlist, history=()):
        captured.append(list(history))
        from app.llm.schemas import AssistantResponse

        return AssistantResponse(message="ok")

    monkeypatch.setattr(chat_api, "generate_response", capture)
    _post(client, "the newest question")

    history = captured[0]
    assert len(history) == chat_api.CONTEXT_HISTORY_LIMIT == 20
    assert [item.content for item in history] == [f"message {index}" for index in range(10, 30)]


def test_the_turns_own_message_is_not_replayed_as_history(client, monkeypatch):
    captured: list[list] = []

    async def capture(message, portfolio, watchlist, history=()):
        captured.append(list(history))
        from app.llm.schemas import AssistantResponse

        return AssistantResponse(message="ok")

    monkeypatch.setattr(chat_api, "generate_response", capture)
    _post(client, "only question")

    assert captured[0] == []
