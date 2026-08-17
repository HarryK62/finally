"""Deterministic stand-in for the LLM, used when ``LLM_MOCK=true``.

Needs no API key and never touches the network, so E2E tests and offline
development get the full chat flow — including real trade and watchlist
execution — with reproducible output.

Behaviour is the keyword table in ``planning/CONTRACTS.md`` §7, matched in that
order, first match wins. Symbols are taken verbatim from the message and only
uppercased: "buy 1 ZZZZ" produces a trade that the portfolio service then rejects,
which is exactly the failed-action path E2E needs to exercise.
"""

from __future__ import annotations

import re

from app.llm.schemas import AssistantResponse, Trade, WatchlistChange
from app.schemas import PortfolioResponse

#: Every mock message starts with this so tests can assert the mock was used.
MOCK_PREFIX = "[mock]"

_QUANTITY = r"(\d+(?:\.\d+)?)"
_SYMBOL = r"([A-Za-z]{1,8})"
_OF = r"(?:shares\s+of\s+)?"

_BUY_PATTERN = re.compile(rf"\bbuy\s+{_QUANTITY}\s+{_OF}{_SYMBOL}\b", re.IGNORECASE)
_SELL_PATTERN = re.compile(rf"\bsell\s+{_QUANTITY}\s+{_OF}{_SYMBOL}\b", re.IGNORECASE)
_ADD_PATTERN = re.compile(rf"\b(?:add|watch)\s+{_SYMBOL}\b", re.IGNORECASE)
_REMOVE_PATTERN = re.compile(rf"\bremove\s+{_SYMBOL}\b", re.IGNORECASE)


def _trade_response(match: re.Match[str], side: str) -> AssistantResponse:
    """Build a one-trade reply from a matched buy/sell phrase."""
    quantity = float(match.group(1))
    ticker = match.group(2).upper()
    verb = "Buying" if side == "buy" else "Selling"
    return AssistantResponse(
        message=f"{MOCK_PREFIX} {verb} {quantity:g} {ticker} at the current market price.",
        trades=[Trade(ticker=ticker, side=side, quantity=quantity)],
    )


def _watchlist_response(match: re.Match[str], action: str) -> AssistantResponse:
    """Build a one-change reply from a matched add/watch/remove phrase."""
    ticker = match.group(1).upper()
    phrase = f"Adding {ticker} to" if action == "add" else f"Removing {ticker} from"
    return AssistantResponse(
        message=f"{MOCK_PREFIX} {phrase} your watchlist.",
        watchlist_changes=[WatchlistChange(ticker=ticker, action=action)],
    )


def generate_response(message: str, portfolio: PortfolioResponse) -> AssistantResponse:
    """Return the canned reply for ``message``, given the live portfolio."""
    if (match := _BUY_PATTERN.search(message)) is not None:
        return _trade_response(match, "buy")
    if (match := _SELL_PATTERN.search(message)) is not None:
        return _trade_response(match, "sell")
    if (match := _ADD_PATTERN.search(message)) is not None:
        return _watchlist_response(match, "add")
    if (match := _REMOVE_PATTERN.search(message)) is not None:
        return _watchlist_response(match, "remove")

    count = len(portfolio.positions)
    return AssistantResponse(
        message=(
            f"{MOCK_PREFIX} You have ${portfolio.cash_balance:,.2f} in cash and "
            f"{count} open position{'' if count == 1 else 's'}, "
            f"a total portfolio value of ${portfolio.total_value:,.2f}. "
            "Ask me to buy or sell shares, or to add or remove a watchlist ticker."
        )
    )
