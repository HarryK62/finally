"""Structured-output models the LLM is required to fill in.

Shapes are fixed by ``planning/CONTRACTS.md`` §7. These are the *request* to act;
the executed outcome is reported back to the client as
:class:`~app.schemas.ChatAction`, which is a different (and wider) shape.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Trade(BaseModel):
    """A trade the assistant wants executed on the user's behalf."""

    ticker: str
    side: Literal["buy", "sell"]
    quantity: float


class WatchlistChange(BaseModel):
    """A watchlist mutation the assistant wants applied."""

    ticker: str
    action: Literal["add", "remove"]


class AssistantResponse(BaseModel):
    """The complete structured reply for one chat turn."""

    message: str
    trades: list[Trade] = Field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = Field(default_factory=list)
