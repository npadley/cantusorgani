"""The corrections database's migrations, replayed in SQLite (D1's engine).

Each test runs the real .sql files from workers/corrections, in order, on an
in-memory database, with rows written the way the live Worker writes them."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

WORKER = Path(__file__).resolve().parents[1] / "workers" / "corrections"


def run(db: sqlite3.Connection, name: str) -> None:
    db.executescript((WORKER / name).read_text(encoding="utf-8"))


@pytest.fixture
def db() -> sqlite3.Connection:
    """Migration 0001 with two reader rows, as the Worker inserts them."""
    conn = sqlite3.connect(":memory:")
    run(conn, "migrations/0001_create_corrections.sql")
    conn.executemany("INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash) VALUES (?, ?, ?, ?, ?)",
                     [("kyrie-i", "mode", "VII", "Liber", "h1"), ("gloria-ii", "title", "Gloria", "", "h2")])
    conn.execute("UPDATE corrections SET status = 'accepted', commit_sha = 'abc1234' WHERE id = 2")
    return conn


def test_migration_0002_keeps_every_row_and_its_status(db):
    run(db, "migrations/0002_admin_workflow.sql")
    rows = db.execute("SELECT id, piece_id, status, source, commit_sha, target FROM corrections ORDER BY id").fetchall()
    assert rows == [(1, "kyrie-i", "pending", "reader", None, None), (2, "gloria-ii", "accepted", "reader", "abc1234", None)]


def test_migration_0002_accepts_the_admin_statuses_and_refuses_others(db):
    run(db, "migrations/0002_admin_workflow.sql")
    for status in ("approved", "queued", "duplicate"):
        db.execute("UPDATE corrections SET status = ? WHERE id = 1", (status,))
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE corrections SET status = 'published' WHERE id = 1")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO corrections (piece_id, field, proposed, source) VALUES ('x', 'title', 'y', 'bot')")


def test_migration_0002_reader_intake_insert_still_works_and_still_dedupes(db):
    run(db, "migrations/0002_admin_workflow.sql")
    insert = "INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash) VALUES (?1, ?2, ?3, ?4, ?5)"
    db.execute(insert, ("credo-i", "mode", "IV", "", "h3"))
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        db.execute(insert, ("credo-i", "mode", "IV", "again", "h4"))
    db.execute("INSERT INTO admin_log (email, action, correction_id) VALUES ('a@b.c', 'approve', 1)")
    assert db.execute("SELECT COUNT(*) FROM admin_log").fetchone() == (1,)


def test_rollback_0002_returns_admin_statuses_to_review_and_drops_the_admin_tables(db):
    run(db, "migrations/0002_admin_workflow.sql")
    db.execute("UPDATE corrections SET status = 'approved', editor_email = 'a@b.c' WHERE id = 1")
    db.execute("INSERT INTO corrections (piece_id, field, proposed, status, source) "
               "VALUES ('kyrie-i', 'mode', 'VII', 'queued', 'editor')")
    db.execute("INSERT INTO corrections (piece_id, field, proposed, status) VALUES ('sanctus-i', 'mode', 'V', 'duplicate')")
    run(db, "rollback/0002_admin_workflow_down.sql")
    rows = db.execute("SELECT piece_id, status FROM corrections ORDER BY id").fetchall()
    # The approved and queued copies of one report collapse back into one pending row.
    assert rows == [("kyrie-i", "pending"), ("gloria-ii", "accepted"), ("sanctus-i", "rejected")]
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "admin_log" not in tables
    columns = {r[1] for r in db.execute("PRAGMA table_info(corrections)")}
    assert "editor_email" not in columns
