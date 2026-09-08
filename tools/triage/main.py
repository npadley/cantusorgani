"""Triage submitted corrections into the catalog.

D1 is a mailbox, never a source of truth. Accepting a correction writes it into
data/catalog.json, which is git-tracked and reviewable as a diff; the D1 row is
then marked with the commit that carried it. The published site can always be
rebuilt from pdf-source/ plus data/ alone.

Corrections arrive from strangers, so nothing here trusts them: every field is
revalidated against the same rules the Worker applies, and a correction naming a
piece that does not exist is refused rather than creating one.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.volumes import DATA, ROOT

DATABASE = "cantusorgani-corrections"
WORKER_DIR = ROOT / "workers" / "corrections"

# Mirrors workers/corrections/src/schema.ts. Kept in step by
# tests/test_triage.py, which fails if the two vocabularies drift.
FIELD_PATTERNS: dict[str, re.Pattern[str]] = {
    "title": re.compile(r"^[^\x00-\x1f<>]{1,120}$"),
    "incipit": re.compile(r"^[^\x00-\x1f<>]{1,120}$"),
    "mode": re.compile(r"^(I|II|III|IV|V|VI|VII|VIII)$"),
    "genre": re.compile(
        r"^(asperges|mass_ordinary|credo|tonus|kyrie|gloria|sanctus|agnus"
        r"|requiem|absolutio|exsequiis)$"
    ),
    "printedPages": re.compile(r"^\d{1,3}-\d{1,3}$"),
    "chant": re.compile(r"^[^\x00-\x1f<>]{1,160}$"),
}

CATALOG_KEY = {
    "title": "title",
    "incipit": "incipit",
    "mode": "mode",
    "genre": "genre",
    "printedPages": "printed_pages",
    "chant": "chant",
}


@dataclass(frozen=True)
class Correction:
    id: int
    piece_id: str
    field: str
    proposed: str
    note: str
    status: str
    created_at: str


class RejectedCorrection(ValueError):
    """A correction that must not be applied."""


def validate(field: str, value: str) -> None:
    pattern = FIELD_PATTERNS.get(field)
    if pattern is None:
        raise RejectedCorrection(
            f"unknown field {field!r}; correctable fields are "
            f"{', '.join(sorted(FIELD_PATTERNS))}"
        )
    if not pattern.fullmatch(value):
        raise RejectedCorrection(
            f"value {value!r} does not match the pattern for {field!r}"
        )


def coerce(field: str, value: str) -> Any:
    """Turn a submitted string into the catalog's own representation."""
    if field == "printedPages":
        first, last = (int(part) for part in value.split("-", 1))
        if first > last:
            raise RejectedCorrection(f"page range {value!r} runs backwards")
        return [first, last]
    return value


def apply_correction(catalog: dict[str, Any], piece_id: str, field: str,
                     value: str) -> dict[str, Any]:
    """Return a new catalog with the correction applied.

    Raises rather than inventing anything: a correction naming a piece that does
    not exist is a bug or an attack, never a reason to create one.
    """
    validate(field, value)
    pieces = catalog.get("pieces", [])
    for piece in pieces:
        if piece.get("id") == piece_id or piece.get("slug") == piece_id:
            piece[CATALOG_KEY[field]] = coerce(field, value)
            return catalog
    raise KeyError(f"no piece with id or slug {piece_id!r}")


def _run(args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed:\n{result.stderr[-800:]}")
    return result.stdout


def _d1(sql: str, remote: bool) -> list[dict[str, Any]]:
    output = _run(
        ["npx", "--yes", "wrangler@4", "d1", "execute", DATABASE,
         "--remote" if remote else "--local", "--json", "--command", sql],
        cwd=WORKER_DIR,
    )
    start = output.find("[")
    if start == -1:
        return []
    payload = json.loads(output[start:])
    results = payload[0].get("results", []) if payload else []
    return list(results)


def fetch_pending(remote: bool = True) -> list[Correction]:
    rows = _d1(
        "SELECT id, piece_id, field, proposed, note, status, created_at "
        "FROM corrections WHERE status = 'pending' ORDER BY created_at",
        remote,
    )
    return [Correction(**row) for row in rows]


def mark(correction_id: int, status: str, commit_sha: str | None,
         remote: bool = True) -> None:
    if status not in {"accepted", "rejected"}:
        raise ValueError(f"refusing to set status {status!r}")
    sha = f"'{commit_sha}'" if commit_sha else "NULL"
    _d1(
        f"UPDATE corrections SET status = '{status}', commit_sha = {sha} "
        f"WHERE id = {int(correction_id)}",
        remote,
    )


def head_sha() -> str:
    return _run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT).strip()


def _cited_page(catalog: dict[str, Any], piece_id: str) -> str:
    for piece in catalog.get("pieces", []):
        if piece.get("id") == piece_id or piece.get("slug") == piece_id:
            first, last = piece.get("printed_pages", [0, 0])
            pdf_first, pdf_last = piece.get("pdf_pages", [0, 0])
            return (f"printed pp. {first}-{last} (PDF {pdf_first}-{pdf_last}); "
                    f"overlay: build/overlay/noh5/{pdf_first:04d}.png")
    return "piece not found in catalog"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="triage", description=__doc__)
    parser.add_argument("--local", action="store_true", help="use the local D1 database")
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would change without writing anything")
    args = parser.parse_args(argv)
    remote = not args.local

    catalog_path = DATA / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

    pending = fetch_pending(remote)
    if not pending:
        print("No pending corrections.")
        return 0

    print(f"{len(pending)} pending correction(s)\n")
    applied = 0
    for c in pending:
        print(f"#{c.id}  {c.piece_id}")
        print(f"    field     {c.field}")
        print(f"    proposed  {c.proposed!r}")
        if c.note:
            print(f"    note      {c.note[:200]!r}")
        print(f"    submitted {c.created_at}")
        print(f"    source    {_cited_page(catalog, c.piece_id)}")

        try:
            validate(c.field, c.proposed)
        except RejectedCorrection as exc:
            print(f"    REFUSED   {exc}\n")
            if not args.dry_run:
                mark(c.id, "rejected", None, remote)
            continue

        if args.dry_run:
            print("    (dry run — not applied)\n")
            continue

        answer = input("    accept? [y/N/q] ").strip().lower()
        if answer == "q":
            break
        if answer != "y":
            mark(c.id, "rejected", None, remote)
            print("    rejected\n")
            continue

        try:
            catalog = apply_correction(catalog, c.piece_id, c.field, c.proposed)
        except (KeyError, RejectedCorrection) as exc:
            print(f"    REFUSED   {exc}\n")
            mark(c.id, "rejected", None, remote)
            continue
        applied += 1
        print("    applied\n")

    if applied and not args.dry_run:
        catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {applied} correction(s) to {catalog_path}.")
        print("Commit, then re-run to record the commit SHA against each row:")
        print("  git add data/catalog.json && git commit -m 'data: apply corrections'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
