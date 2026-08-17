"""Tests for the deterministic mock assistant (CONTRACTS.md §7 keyword table)."""

from __future__ import annotations

import pytest

from app.llm import mock
from app.schemas import PortfolioResponse, Position


def _portfolio(cash: float = 8_050.0, positions: list[Position] | None = None) -> PortfolioResponse:
    positions = positions or []
    positions_value = sum(position.market_value for position in positions)
    return PortfolioResponse(
        cash_balance=cash,
        positions=positions,
        positions_value=positions_value,
        total_value=cash + positions_value,
        total_cost_basis=sum(position.cost_basis for position in positions),
        total_unrealized_pnl=sum(position.unrealized_pnl for position in positions),
        total_unrealized_pnl_percent=0.0,
    )


def _position(ticker: str = "AAPL") -> Position:
    return Position(
        ticker=ticker,
        quantity=10.0,
        avg_cost=190.0,
        current_price=195.0,
        market_value=1950.0,
        cost_basis=1900.0,
        unrealized_pnl=50.0,
        unrealized_pnl_percent=2.63,
        weight=1.0,
    )


# --- Keyword table ---


@pytest.mark.parametrize(
    ("message", "ticker", "quantity"),
    [
        ("buy 5 AAPL", "AAPL", 5.0),
        ("Buy 2.5 nvda please", "NVDA", 2.5),
        ("could you buy 10 shares of MSFT", "MSFT", 10.0),
    ],
)
def test_buy_keyword_produces_one_buy_trade(message, ticker, quantity):
    response = mock.generate_response(message, _portfolio())
    assert [(t.ticker, t.side, t.quantity) for t in response.trades] == [
        (ticker, "buy", quantity)
    ]
    assert response.watchlist_changes == []
    assert response.message.startswith(mock.MOCK_PREFIX)


@pytest.mark.parametrize(
    ("message", "ticker", "quantity"),
    [
        ("sell 3 TSLA", "TSLA", 3.0),
        ("SELL 1.5 shares of googl now", "GOOGL", 1.5),
    ],
)
def test_sell_keyword_produces_one_sell_trade(message, ticker, quantity):
    response = mock.generate_response(message, _portfolio())
    assert [(t.ticker, t.side, t.quantity) for t in response.trades] == [
        (ticker, "sell", quantity)
    ]
    assert response.watchlist_changes == []


@pytest.mark.parametrize(
    ("message", "ticker"),
    [
        ("add PYPL", "PYPL"),
        ("add pypl to my watchlist", "PYPL"),
        ("watch NFLX", "NFLX"),
    ],
)
def test_add_and_watch_keywords_produce_a_watchlist_add(message, ticker):
    response = mock.generate_response(message, _portfolio())
    assert [(c.ticker, c.action) for c in response.watchlist_changes] == [(ticker, "add")]
    assert response.trades == []
    assert response.message.startswith(mock.MOCK_PREFIX)


@pytest.mark.parametrize(
    ("message", "ticker"),
    [
        ("remove TSLA", "TSLA"),
        ("please remove nflx from the watchlist", "NFLX"),
    ],
)
def test_remove_keyword_produces_a_watchlist_remove(message, ticker):
    response = mock.generate_response(message, _portfolio())
    assert [(c.ticker, c.action) for c in response.watchlist_changes] == [(ticker, "remove")]
    assert response.trades == []


def test_unmatched_message_has_no_actions_and_reports_cash_and_position_count():
    response = mock.generate_response("how am I doing?", _portfolio(positions=[_position()]))
    assert response.trades == []
    assert response.watchlist_changes == []
    assert response.message.startswith(mock.MOCK_PREFIX)
    assert "$8,050.00" in response.message
    assert "1 open position" in response.message


def test_unmatched_message_pluralizes_an_empty_portfolio():
    response = mock.generate_response("hello", _portfolio())
    assert "0 open positions" in response.message


def test_the_word_watchlist_alone_is_not_a_watch_command():
    response = mock.generate_response("show me my watchlist", _portfolio())
    assert response.watchlist_changes == []
    assert response.trades == []


def test_a_trade_keyword_wins_over_a_watchlist_keyword():
    response = mock.generate_response("buy 1 AAPL and add MSFT", _portfolio())
    assert [t.ticker for t in response.trades] == ["AAPL"]
    assert response.watchlist_changes == []


def test_unknown_symbols_pass_through_for_the_service_layer_to_reject():
    response = mock.generate_response("buy 1 ZZZZ", _portfolio())
    assert response.trades[0].ticker == "ZZZZ"


def test_output_is_deterministic():
    portfolio = _portfolio(positions=[_position()])
    first = mock.generate_response("buy 5 AAPL", portfolio)
    second = mock.generate_response("buy 5 AAPL", portfolio)
    assert first.model_dump() == second.model_dump()

    assert (
        mock.generate_response("hello", portfolio).message
        == mock.generate_response("hello", portfolio).message
    )


def test_mock_needs_no_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert mock.generate_response("buy 5 AAPL", _portfolio()).trades[0].quantity == 5.0
