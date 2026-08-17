"""Tests for schema creation, seeding and the shared database helpers."""

from __future__ import annotations

import re

import pytest

from app.config import DEFAULT_USER_ID, get_settings
from app.db import database
from app.market.seed_prices import SEED_PRICES

EXPECTED_TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


def _table_names() -> set[str]:
    with database.get_connection() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {row["name"] for row in rows}


def test_init_db_creates_all_tables(temp_db):
    assert EXPECTED_TABLES <= _table_names()


def test_init_db_creates_the_file(temp_db):
    assert temp_db.exists()
    assert get_settings().DB_PATH == temp_db


def test_seeds_profile_with_starting_cash(temp_db):
    with database.get_connection() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()
    assert row["cash_balance"] == pytest.approx(10000.0)


def test_seeds_the_default_watchlist_from_market_seed_prices(temp_db):
    with database.get_connection() as conn:
        rows = conn.execute("SELECT ticker FROM watchlist").fetchall()
    assert {row["ticker"] for row in rows} == set(SEED_PRICES)


def test_init_db_is_idempotent(temp_db):
    database.init_db()
    database.init_db()
    with database.get_connection() as conn:
        profiles = conn.execute("SELECT COUNT(*) AS n FROM users_profile").fetchone()["n"]
        watched = conn.execute("SELECT COUNT(*) AS n FROM watchlist").fetchone()["n"]
    assert profiles == 1
    assert watched == len(SEED_PRICES)


def test_seeding_does_not_reset_a_spent_balance(temp_db):
    with database.write_connection() as conn:
        conn.execute("UPDATE users_profile SET cash_balance = 42.0 WHERE id = ?",
                     (DEFAULT_USER_ID,))
    database.init_db()
    with database.get_connection() as conn:
        cash = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()["cash_balance"]
    assert cash == pytest.approx(42.0)


def test_connection_pragmas(temp_db):
    with database.get_connection() as conn:
        journal = conn.execute("PRAGMA journal_mode").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert journal.lower() == "wal"
    assert foreign_keys == 1


def test_write_connection_rolls_back_on_error(temp_db):
    with pytest.raises(ValueError):
        with database.write_connection() as conn:
            conn.execute(
                "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
                "VALUES ('x', 'default', 'AAPL', 'buy', 1, 1, 'now')"
            )
            raise ValueError("boom")

    with database.get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM trades").fetchone()["n"]
    assert count == 0


def test_utc_now_iso_format():
    stamp = database.utc_now_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", stamp), stamp


def test_new_id_is_unique():
    assert database.new_id() != database.new_id()


def test_side_check_constraint_rejects_bad_values(temp_db):
    import sqlite3

    with pytest.raises(sqlite3.IntegrityError):
        with database.write_connection() as conn:
            conn.execute(
                "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
                "VALUES ('x', 'default', 'AAPL', 'hodl', 1, 1, 'now')"
            )
