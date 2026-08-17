"""Environment-driven settings for the FinAlly backend.

Settings are read fresh from the environment on every :func:`get_settings` call so
that tests can monkeypatch ``DB_PATH`` (and friends) without cache invalidation
games. The ``.env`` file at the repository root is loaded once at import time and
never overrides variables that are already present in the real environment.

Layout assumption (holds both locally and in Docker)::

    <repo_root>/backend/app/config.py   ->   REPO_ROOT = <repo_root>
    /app/backend/app/config.py          ->   REPO_ROOT = /app
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# <repo_root>/backend/app/config.py -> app -> backend -> <repo_root>
REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent

# Real environment variables win over .env values (important for Docker and tests).
load_dotenv(REPO_ROOT / ".env", override=False)

# Constants (not environment driven)
DEFAULT_USER_ID = "default"
SNAPSHOT_INTERVAL_SECONDS = 30

_TRUE_VALUES = {"true", "1"}


def _env_flag(name: str, default: bool = False) -> bool:
    """Read a boolean env var: true iff it lowercases to 'true' or '1'."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUE_VALUES


@dataclass(frozen=True, slots=True)
class Settings:
    """Immutable snapshot of the process configuration."""

    DB_PATH: Path
    OPENROUTER_API_KEY: str
    MASSIVE_API_KEY: str
    LLM_MOCK: bool
    STATIC_DIR: Path
    DEFAULT_USER_ID: str = DEFAULT_USER_ID
    SNAPSHOT_INTERVAL_SECONDS: int = SNAPSHOT_INTERVAL_SECONDS

    @property
    def market_source_name(self) -> str:
        """'massive' when a Massive API key is configured, else 'simulator'."""
        return "massive" if self.MASSIVE_API_KEY else "simulator"


def get_settings() -> Settings:
    """Build a :class:`Settings` from the current environment.

    Cheap enough to call per request; deliberately uncached so that tests which
    monkeypatch ``DB_PATH`` take effect immediately.
    """
    return Settings(
        DB_PATH=Path(os.environ.get("DB_PATH") or (REPO_ROOT / "db" / "finally.db")),
        OPENROUTER_API_KEY=os.environ.get("OPENROUTER_API_KEY", "").strip(),
        MASSIVE_API_KEY=os.environ.get("MASSIVE_API_KEY", "").strip(),
        LLM_MOCK=_env_flag("LLM_MOCK"),
        STATIC_DIR=Path(os.environ.get("STATIC_DIR") or (REPO_ROOT / "backend" / "static")),
    )
