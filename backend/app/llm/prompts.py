"""System prompt and live-context construction for the chat assistant.

The model gets three things: who it is and what it may do (:data:`SYSTEM_PROMPT`),
a freshly rendered snapshot of the portfolio and watchlist, and the recent
conversation. Context is rendered as compact plain text rather than JSON — it is
cheaper in tokens and the model reads it just as well.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.schemas import ChatMessage, PortfolioResponse, WatchlistResponse

SYSTEM_PROMPT = """You are FinAlly, an AI trading assistant embedded in a simulated \
trading workstation. The user trades a virtual $10,000 portfolio; there is no real money \
at stake and no order confirmation step.

Your job:
- Analyze portfolio composition, risk concentration and P&L using the live context below.
- Suggest trades with a short, concrete reason.
- Execute trades when the user asks for one or agrees to your suggestion, by filling in the
  `trades` array. Only market orders exist: instant fill at the current price.
- Manage the watchlist proactively via `watchlist_changes` when a ticker becomes relevant.

Rules:
- Be concise and data-driven. A few sentences, no filler, no disclaimers about being an AI.
- Quote real numbers from the context; never invent a price or a position you cannot see.
- Only fill `trades` when the user actually wants a trade. Discussing an idea is not consent;
  a direct instruction ("buy 5 NVDA") or agreement to your suggestion is.
- Tickers must be uppercase symbols. Quantities are positive numbers; fractional shares are fine.
- A trade may still be rejected afterwards (insufficient cash or shares). Do not claim a fill is
  guaranteed.
- Always reply with valid JSON matching the required schema. `message` is what the user reads,
  so never put raw JSON in it."""


def build_portfolio_context(
    portfolio: PortfolioResponse,
    watchlist: WatchlistResponse,
) -> str:
    """Render cash, positions with P&L, and watchlist prices as plain text."""
    lines = [
        "=== LIVE ACCOUNT CONTEXT ===",
        f"Cash balance: ${portfolio.cash_balance:,.2f}",
        f"Positions value: ${portfolio.positions_value:,.2f}",
        f"Total portfolio value: ${portfolio.total_value:,.2f}",
        (
            f"Total unrealized P&L: ${portfolio.total_unrealized_pnl:,.2f} "
            f"({portfolio.total_unrealized_pnl_percent:+.2f}%)"
        ),
        "",
        "Positions:",
    ]

    if portfolio.positions:
        lines.extend(
            f"  {position.ticker}: {position.quantity:g} shares @ avg "
            f"${position.avg_cost:,.2f}, now ${position.current_price:,.2f}, "
            f"value ${position.market_value:,.2f}, "
            f"P&L ${position.unrealized_pnl:,.2f} ({position.unrealized_pnl_percent:+.2f}%), "
            f"weight {position.weight * 100:.1f}%"
            for position in portfolio.positions
        )
    else:
        lines.append("  (none — the portfolio is all cash)")

    lines.extend(("", "Watchlist:"))
    if watchlist.tickers:
        lines.extend(
            f"  {item.ticker}: "
            + (
                f"${item.price:,.2f} ({item.change_percent:+.2f}%)"
                if item.price is not None
                else "no price yet"
            )
            for item in watchlist.tickers
        )
    else:
        lines.append("  (empty)")

    return "\n".join(lines)


def build_messages(
    message: str,
    portfolio: PortfolioResponse,
    watchlist: WatchlistResponse,
    history: Sequence[ChatMessage] = (),
) -> list[dict[str, str]]:
    """Assemble the chat payload: system prompt, live context, history, new message.

    The context is a second system message placed after the prompt so that it is
    never confused with something the user said, and so it stays adjacent to the
    most recent turns rather than buried behind a long history.
    """
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": build_portfolio_context(portfolio, watchlist)},
    ]
    messages.extend({"role": item.role, "content": item.content} for item in history)
    messages.append({"role": "user", "content": message})
    return messages
