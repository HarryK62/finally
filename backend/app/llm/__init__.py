"""LLM integration: structured-output chat with trade and watchlist execution.

The public surface is :func:`app.llm.client.generate_response`, which returns an
:class:`~app.llm.schemas.AssistantResponse` from either OpenRouter/Cerebras or the
deterministic mock in :mod:`app.llm.mock`. Executing the actions it asks for is the
job of :mod:`app.api.chat` — nothing in this package touches the database.
"""

from __future__ import annotations

from app.llm.client import LLMUnavailableError, generate_response
from app.llm.schemas import AssistantResponse, Trade, WatchlistChange

__all__ = [
    "AssistantResponse",
    "LLMUnavailableError",
    "Trade",
    "WatchlistChange",
    "generate_response",
]
