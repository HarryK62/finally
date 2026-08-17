"""Database layer: schema, connection management, lazy initialization and seeding.

Public API:
    init_db          - Create the schema and seed defaults (idempotent)
    ensure_db        - init_db, but a no-op after the first call per database path
    get_connection   - Read connection context manager
    write_connection - Serialized write connection context manager (commits)
    utc_now_iso      - Shared ISO-8601 UTC timestamp helper
    new_id           - Shared UUID string helper
"""

from .database import (
    ensure_db,
    get_connection,
    init_db,
    new_id,
    reset_state,
    utc_now_iso,
    write_connection,
)

__all__ = [
    "ensure_db",
    "get_connection",
    "init_db",
    "new_id",
    "reset_state",
    "utc_now_iso",
    "write_connection",
]
