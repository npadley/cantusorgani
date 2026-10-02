"""Structural guards on D1 migrations.

`wrangler d1 migrations apply` runs EVERY .sql file in the migrations directory,
in lexical order. Keeping a down script beside its up script therefore creates
the table and immediately drops it again — and wrangler reports both with a green
tick, so the run looks like a success.

That happened on the first real deploy of cantusorgani-corrections: the table was
created, dropped, and the summary said everything was fine. Down scripts now live
in rollback/ and are applied by hand.
"""

import re
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


REBUILD = re.compile(r"drop table (\w+);")


def without_table_rebuilds(sql: str) -> str:
    """The text with each complete table rebuild's DROP removed.

    SQLite cannot ALTER a CHECK constraint, so changing one means a rebuild:
    create <t>_new, copy every row from <t>, drop <t>, rename <t>_new to <t>.
    That DROP loses nothing -- the rows are already copied -- but only when all
    four steps are in the same file, so only then is it allowed."""
    for table in REBUILD.findall(sql):
        complete = (f"create table {table}_new" in sql
                    and re.search(rf"insert into {table}_new\b[^;]*\bfrom {table}\b", sql)
                    and f"alter table {table}_new rename to {table};" in sql)
        if complete:
            sql = sql.replace(f"drop table {table};", "")
    return sql


def without_index_replacements(sql: str) -> str:
    """Permit constraint/index replacement only with its named replacement in the same migration."""
    for name in re.findall(r"drop index (\w+);", sql):
        if re.search(rf"create unique index {name}\s+on corrections\b", sql):
            sql = sql.replace(f"drop index {name};", "")
    return sql


def test_index_replacement_requires_the_same_unique_index():
    assert "drop index" not in without_index_replacements("drop index old; create unique index old on corrections (target);")
    assert "drop index" in without_index_replacements("drop index old; create unique index other on corrections (target);")
    assert "drop index" in without_index_replacements("drop index old;")


@pytest.mark.parametrize("directory", migration_dirs(), ids=lambda d: str(d))
def test_migrations_contain_nothing_destructive(directory):
    """A destructive statement in migrations/ is applied automatically."""
    for sql in directory.glob("*.sql"):
        lowered = without_index_replacements(without_table_rebuilds(sql.read_text(encoding="utf-8").lower()))
        for statement in DESTRUCTIVE:
            assert statement not in lowered, (
                f"{sql} contains {statement!r}. wrangler applies every .sql file in "
                f"migrations/, so this would run on deploy. Move it to rollback/ (a table "
                f"rebuild that copies every row first is the one exception)."
            )


def test_without_table_rebuilds_allows_only_a_complete_rebuild():
    rebuild = ("create table t_new (a); insert into t_new (a) select a from t; drop table t; "
               "alter table t_new rename to t;")
    assert "drop table" not in without_table_rebuilds(rebuild)
    assert "drop table" in without_table_rebuilds("create table t_new (a); drop table t; "
                                                  "alter table t_new rename to t;")
    assert "drop table" in without_table_rebuilds("drop table t;")


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
