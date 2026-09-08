"""Structural guards on D1 migrations.

`wrangler d1 migrations apply` runs EVERY .sql file in the migrations directory,
in lexical order. Keeping a down script beside its up script therefore creates
the table and immediately drops it again — and wrangler reports both with a green
tick, so the run looks like a success.

That happened on the first real deploy of cantusorgani-corrections: the table was
created, dropped, and the summary said everything was fine. Down scripts now live
in rollback/ and are applied by hand.
"""

from pathlib import Path

import pytest

WORKERS = Path("workers")
DESTRUCTIVE = ("drop table", "drop index", "delete from", "truncate")


def migration_dirs() -> list[Path]:
    return sorted(WORKERS.glob("*/migrations"))


def rollback_dirs() -> list[Path]:
    return sorted(WORKERS.glob("*/rollback"))


def test_there_is_at_least_one_migration():
    assert migration_dirs(), "no workers/*/migrations directory found"
    assert any(d.glob("*.sql") for d in migration_dirs())


@pytest.mark.parametrize("directory", migration_dirs(), ids=lambda d: str(d))
def test_migrations_contain_nothing_destructive(directory):
    """A destructive statement in migrations/ is applied automatically."""
    for sql in directory.glob("*.sql"):
        lowered = sql.read_text(encoding="utf-8").lower()
        for statement in DESTRUCTIVE:
            assert statement not in lowered, (
                f"{sql} contains {statement!r}. wrangler applies every .sql file in "
                f"migrations/, so this would run on deploy. Move it to rollback/."
            )


@pytest.mark.parametrize("directory", migration_dirs(), ids=lambda d: str(d))
def test_no_down_scripts_live_in_migrations(directory):
    offenders = [p.name for p in directory.glob("*.sql") if "down" in p.name.lower()]
    assert not offenders, (
        f"{offenders} are in migrations/ and would be applied on deploy. "
        f"Down scripts belong in rollback/."
    )


@pytest.mark.parametrize("directory", migration_dirs(), ids=lambda d: str(d))
def test_every_migration_has_a_paired_rollback(directory):
    """The rollback contract requires a down script for each migration, even
    though reaching for one should be rare."""
    rollback = directory.parent / "rollback"
    for sql in directory.glob("*.sql"):
        expected = rollback / f"{sql.stem}_down.sql"
        assert expected.exists(), f"{sql.name} has no paired {expected}"


@pytest.mark.parametrize("directory", rollback_dirs(), ids=lambda d: str(d))
def test_rollback_scripts_document_their_backup_command(directory):
    """Running one destroys data; the export command must be right there."""
    for sql in directory.glob("*.sql"):
        text = sql.read_text(encoding="utf-8").lower()
        assert "d1 export" in text, f"{sql} does not tell the reader to back up first"
