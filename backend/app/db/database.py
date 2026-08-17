"""SQLite connection management, lazy initialization and seeding.

Connections are short-lived and created per operation — SQLite in WAL mode handles
this cheaply and it guarantees no connection is ever held across an ``await``.

Writes arrive from two places (the request path and the 30-second snapshot task),
so every write goes through :func:`write_connection`, which serializes on a
module-level :class:`threading.Lock` and commits (or rolls back) as a unit.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.config import DEFAULT_USER_ID, get_settings
from app.market.seed_prices import SEED_PRICES

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

STARTING_CASH = 10000.0

# Serializes all writers: request handlers and the snapshot background task.
_write_lock = threading.Lock()

# Database paths already initialized in this process, so ensure_db() stays cheap.
_initialized_paths: set[str] = set()
_init_lock = threading.Lock()


# --- Shared helpers ---


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string with millisecond precision and 'Z'.

    Example: ``2026-08-17T14:03:22.481Z``
    """
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    """A fresh UUID4 primary key as a string."""
    return str(uuid.uuid4())


def get_db_path() -> Path:
    """Resolved path of the SQLite file for the current settings."""
    return get_settings().DB_PATH


# --- Connections ---


def _connect() -> sqlite3.Connection:
    """Open a configured connection, creating the parent directory if needed."""
    path = get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Read-oriented connection. Not serialized; does not commit."""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_connection() -> Iterator[sqlite3.Connection]:
    """Serialized write connection. Commits on success, rolls back on error.

    Everything inside the ``with`` block is one SQLite transaction.
    """
    with _write_lock:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()


# --- Initialization and seeding ---


def init_db() -> None:
    """Create the schema and seed default data. Idempotent and safe to re-run."""
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with write_connection() as conn:
        conn.executescript(schema_sql)
        _seed_defaults(conn)
    _initialized_paths.add(str(get_db_path()))
    logger.info("Database ready at %s", get_db_path())


def ensure_db() -> None:
    """Run :func:`init_db` once per database path per process."""
    if str(get_db_path()) in _initialized_paths:
        return
    with _init_lock:
        if str(get_db_path()) in _initialized_paths:
            return
        init_db()


def reset_state() -> None:
    """Forget which paths have been initialized. Intended for tests."""
    _initialized_paths.clear()


def _seed_defaults(conn: sqlite3.Connection, user_id: str = DEFAULT_USER_ID) -> None:
    """Insert the default profile and watchlist if the profile row is missing."""
    row = conn.execute("SELECT 1 FROM users_profile WHERE id = ?", (user_id,)).fetchone()
    if row is not None:
        return

    now = utc_now_iso()
    conn.execute(
        "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (user_id, STARTING_CASH, now),
    )
    conn.executemany(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        [(new_id(), user_id, ticker, now) for ticker in default_tickers()],
    )
    logger.info("Seeded default profile and %d watchlist tickers", len(default_tickers()))


def default_tickers() -> list[str]:
    """The default watchlist, sourced from the market module's seed prices."""
    return list(SEED_PRICES.keys())
