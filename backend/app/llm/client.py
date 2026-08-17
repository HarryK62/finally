"""The LLM call itself: LiteLLM -> OpenRouter -> Cerebras, with structured output.

One public coroutine, :func:`generate_response`, which either dispatches to the
deterministic mock (``LLM_MOCK=true``) or makes a real completion request and
parses the result into an :class:`~app.llm.schemas.AssistantResponse`.

Anything that stops us getting a usable reply — no API key, a network error, a
provider error, an empty completion — is raised as :class:`LLMUnavailableError`,
which the chat router turns into a 503. A *malformed but non-empty* reply is not
a failure: it degrades to a plain-text answer with no actions, because losing the
assistant's words is worse than losing its trades.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from typing import Any

from anyio import to_thread
from pydantic import ValidationError

from app.config import get_settings
from app.llm import mock
from app.llm.prompts import build_messages
from app.llm.schemas import AssistantResponse
from app.schemas import ChatMessage, PortfolioResponse, WatchlistResponse

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}
REASONING_EFFORT = "low"
REQUEST_TIMEOUT_SECONDS = 60.0


class LLMUnavailableError(RuntimeError):
    """The assistant could not be reached or produced nothing usable."""


def _load_completion() -> Callable[..., Any]:
    """Import ``litellm.completion`` lazily.

    ``litellm`` is a multi-second import and the mock path never needs it, so it
    stays out of application startup and out of the unit tests (which patch this
    function rather than the network).
    """
    from litellm import completion

    return completion


def _redact(text: str, secret: str) -> str:
    """Strip an API key out of text before it is logged or returned to a client."""
    return text.replace(secret, "***") if secret else text


def _strip_code_fences(content: str) -> str:
    """Remove a leading ```json fence and its closing fence, if present."""
    text = content.strip()
    if not text.startswith("```"):
        return text
    body = text[3:]
    if body.lower().startswith("json"):
        body = body[4:]
    return body.rsplit("```", 1)[0].strip() if "```" in body else body.strip()


def parse_completion(content: str | None) -> AssistantResponse:
    """Turn raw completion text into an :class:`AssistantResponse`.

    Falls back to a message-only response when the model ignores the schema, so a
    chatty reply still reaches the user. Only an empty completion is fatal.

    Raises:
        LLMUnavailableError: if the completion is missing or blank.
    """
    if content is None or not content.strip():
        raise LLMUnavailableError("the model returned an empty response")

    text = _strip_code_fences(content)
    try:
        return AssistantResponse.model_validate_json(text)
    except ValidationError:
        logger.warning("LLM response did not match the schema; falling back to plain text")

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None

    # A well-formed object with an unusable actions array: keep the words, drop the actions.
    if isinstance(data, dict) and isinstance(data.get("message"), str):
        return AssistantResponse(message=data["message"])

    return AssistantResponse(message=text.strip())


def _call_llm(messages: list[dict[str, str]], api_key: str) -> str | None:
    """Blocking completion request. Runs in a worker thread."""
    completion = _load_completion()
    response = completion(
        model=MODEL,
        messages=messages,
        response_format=AssistantResponse,
        reasoning_effort=REASONING_EFFORT,
        extra_body=EXTRA_BODY,
        api_key=api_key,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response.choices[0].message.content


async def generate_response(
    message: str,
    portfolio: PortfolioResponse,
    watchlist: WatchlistResponse,
    history: Sequence[ChatMessage] = (),
) -> AssistantResponse:
    """Ask the assistant for a structured reply to ``message``.

    Raises:
        LLMUnavailableError: on a missing API key, a network/provider failure, or
            an empty completion.
    """
    settings = get_settings()
    if settings.LLM_MOCK:
        return mock.generate_response(message, portfolio)

    if not settings.OPENROUTER_API_KEY:
        raise LLMUnavailableError("OPENROUTER_API_KEY is not configured")

    messages = build_messages(message, portfolio, watchlist, history)
    try:
        content = await to_thread.run_sync(_call_llm, messages, settings.OPENROUTER_API_KEY)
    except Exception as exc:  # litellm raises a wide family of provider/network errors
        reason = _redact(str(exc), settings.OPENROUTER_API_KEY) or exc.__class__.__name__
        logger.error("LLM request failed: %s", reason)
        raise LLMUnavailableError(reason) from exc

    return parse_completion(content)
