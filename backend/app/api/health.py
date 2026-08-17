"""Health check endpoint used by Docker, deployment platforms and E2E tests."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.market.massive_client import MassiveDataSource
from app.runtime import get_market_source
from app.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["system"])


def _market_source_name() -> str:
    """Report the source actually running, falling back to configuration."""
    try:
        source = get_market_source()
    except RuntimeError:
        return get_settings().market_source_name
    return "massive" if isinstance(source, MassiveDataSource) else "simulator"


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe reporting which market source and LLM mode are active."""
    return HealthResponse(
        status="ok",
        market_source=_market_source_name(),
        llm_mock=get_settings().LLM_MOCK,
    )
