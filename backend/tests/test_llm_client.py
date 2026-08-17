"""Tests for the LLM client: dispatch, structured-output parsing and failures.

No test here touches the network — the live path is exercised by patching
``app.llm.client._load_completion``, which is the only place ``litellm`` is used.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.llm import client, prompts
from app.llm.client import LLMUnavailableError, parse_completion
from app.schemas import ChatMessage, PortfolioResponse, Position, WatchlistItem, WatchlistResponse

API_KEY = "sk-or-v1-test-key-never-real"


@pytest.fixture
def portfolio() -> PortfolioResponse:
    position = Position(
        ticker="AAPL",
        quantity=10.0,
        avg_cost=190.0,
        current_price=195.0,
        market_value=1950.0,
        cost_basis=1900.0,
        unrealized_pnl=50.0,
        unrealized_pnl_percent=2.63,
        weight=1.0,
    )
    return PortfolioResponse(
        cash_balance=8050.0,
        positions=[position],
        positions_value=1950.0,
        total_value=10000.0,
        total_cost_basis=1900.0,
        total_unrealized_pnl=50.0,
        total_unrealized_pnl_percent=2.63,
    )


@pytest.fixture
def watchlist() -> WatchlistResponse:
    return WatchlistResponse(
        tickers=[
            WatchlistItem(
                ticker="AAPL",
                added_at="2026-08-17T14:00:00.000Z",
                price=195.0,
                previous_price=194.5,
                change=0.5,
                change_percent=0.26,
                direction="up",
            ),
            WatchlistItem(
                ticker="PYPL",
                added_at="2026-08-17T14:01:00.000Z",
                price=None,
                previous_price=None,
                change=0.0,
                change_percent=0.0,
                direction="flat",
            ),
        ]
    )


@pytest.fixture
def live_mode(monkeypatch):
    """A configured live client: mock off, API key present."""
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)


def _completion_returning(content: str | None, calls: list[dict] | None = None):
    """A stand-in for ``litellm.completion`` that records its keyword arguments."""

    def fake_completion(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    return lambda: fake_completion


# --- Structured output parsing ---


def test_parses_a_full_structured_response():
    payload = json.dumps(
        {
            "message": "Buying 5 AAPL.",
            "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5}],
            "watchlist_changes": [{"ticker": "PYPL", "action": "add"}],
        }
    )
    response = parse_completion(payload)
    assert response.message == "Buying 5 AAPL."
    assert (response.trades[0].ticker, response.trades[0].side) == ("AAPL", "buy")
    assert response.trades[0].quantity == 5.0
    assert (response.watchlist_changes[0].ticker, response.watchlist_changes[0].action) == (
        "PYPL",
        "add",
    )


def test_omitted_action_arrays_default_to_empty():
    response = parse_completion('{"message": "Your portfolio looks concentrated."}')
    assert response.trades == []
    assert response.watchlist_changes == []


def test_parses_a_response_wrapped_in_a_code_fence():
    fenced = '```json\n{"message": "Hi", "trades": []}\n```'
    assert parse_completion(fenced).message == "Hi"


def test_malformed_json_degrades_to_a_plain_text_message():
    response = parse_completion("Sorry, I can only think in prose today.")
    assert response.message == "Sorry, I can only think in prose today."
    assert response.trades == []


def test_truncated_json_degrades_to_plain_text():
    response = parse_completion('{"message": "half a th')
    assert response.trades == []
    assert response.message.startswith("{")


def test_schema_violating_actions_are_dropped_but_the_message_survives():
    payload = json.dumps(
        {"message": "Going long.", "trades": [{"ticker": "AAPL", "side": "long", "quantity": 5}]}
    )
    response = parse_completion(payload)
    assert response.message == "Going long."
    assert response.trades == []


@pytest.mark.parametrize("content", [None, "", "   "])
def test_an_empty_completion_is_unavailable(content):
    with pytest.raises(LLMUnavailableError):
        parse_completion(content)


# --- Dispatch ---


async def test_mock_mode_never_calls_litellm(monkeypatch, portfolio, watchlist):
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    def explode():
        raise AssertionError("litellm must not be loaded in mock mode")

    monkeypatch.setattr(client, "_load_completion", explode)

    response = await client.generate_response("buy 5 AAPL", portfolio, watchlist)
    assert response.message.startswith("[mock]")
    assert response.trades[0].ticker == "AAPL"


async def test_missing_api_key_is_unavailable(monkeypatch, portfolio, watchlist):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")

    with pytest.raises(LLMUnavailableError, match="OPENROUTER_API_KEY"):
        await client.generate_response("hello", portfolio, watchlist)


async def test_live_call_uses_cerebras_and_structured_output(
    monkeypatch, live_mode, portfolio, watchlist
):
    calls: list[dict] = []
    monkeypatch.setattr(
        client,
        "_load_completion",
        _completion_returning('{"message": "Done.", "trades": []}', calls),
    )

    history = [
        ChatMessage(id="1", role="user", content="hi", created_at="2026-08-17T14:00:00.000Z"),
        ChatMessage(
            id="2", role="assistant", content="hello", created_at="2026-08-17T14:00:01.000Z"
        ),
    ]
    response = await client.generate_response("buy 5 AAPL", portfolio, watchlist, history)

    assert response.message == "Done."
    assert len(calls) == 1
    kwargs = calls[0]
    assert kwargs["model"] == "openrouter/openai/gpt-oss-120b"
    assert kwargs["extra_body"] == {"provider": {"order": ["cerebras"]}}
    assert kwargs["reasoning_effort"] == "low"
    assert kwargs["response_format"] is client.AssistantResponse
    assert kwargs["api_key"] == API_KEY

    roles = [message["role"] for message in kwargs["messages"]]
    assert roles == ["system", "system", "user", "assistant", "user"]
    assert kwargs["messages"][-1]["content"] == "buy 5 AAPL"
    assert "FinAlly" in kwargs["messages"][0]["content"]
    assert "8,050.00" in kwargs["messages"][1]["content"]


async def test_a_provider_error_is_unavailable(monkeypatch, live_mode, portfolio, watchlist):
    def raising_loader():
        def fake_completion(**kwargs):
            raise ConnectionError("openrouter is down")

        return fake_completion

    monkeypatch.setattr(client, "_load_completion", raising_loader)

    with pytest.raises(LLMUnavailableError, match="openrouter is down"):
        await client.generate_response("hello", portfolio, watchlist)


async def test_the_api_key_is_never_leaked_in_the_error(
    monkeypatch, live_mode, portfolio, watchlist
):
    def raising_loader():
        def fake_completion(**kwargs):
            raise RuntimeError(f"401 unauthorized for key {API_KEY}")

        return fake_completion

    monkeypatch.setattr(client, "_load_completion", raising_loader)

    with pytest.raises(LLMUnavailableError) as excinfo:
        await client.generate_response("hello", portfolio, watchlist)
    assert API_KEY not in str(excinfo.value)
    assert "***" in str(excinfo.value)


async def test_an_empty_live_completion_is_unavailable(
    monkeypatch, live_mode, portfolio, watchlist
):
    monkeypatch.setattr(client, "_load_completion", _completion_returning(""))

    with pytest.raises(LLMUnavailableError):
        await client.generate_response("hello", portfolio, watchlist)


# --- Prompt construction ---


def test_context_reports_cash_positions_and_watchlist_prices(portfolio, watchlist):
    context = prompts.build_portfolio_context(portfolio, watchlist)
    assert "Cash balance: $8,050.00" in context
    assert "AAPL: 10 shares @ avg $190.00, now $195.00" in context
    assert "+2.63%" in context
    assert "PYPL: no price yet" in context


def test_context_handles_an_all_cash_portfolio(watchlist):
    empty = PortfolioResponse(
        cash_balance=10000.0,
        positions=[],
        positions_value=0.0,
        total_value=10000.0,
        total_cost_basis=0.0,
        total_unrealized_pnl=0.0,
        total_unrealized_pnl_percent=0.0,
    )
    assert "(none — the portfolio is all cash)" in prompts.build_portfolio_context(empty, watchlist)


def test_build_messages_replays_history_in_order(portfolio, watchlist):
    history = [
        ChatMessage(id="1", role="user", content="first", created_at="a"),
        ChatMessage(id="2", role="assistant", content="second", created_at="b"),
    ]
    messages = prompts.build_messages("third", portfolio, watchlist, history)
    assert [m["content"] for m in messages[2:]] == ["first", "second", "third"]
