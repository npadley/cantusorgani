"""Triage submitted corrections into the catalog.

D1 is a mailbox, never a source of truth. Accepting a correction records it in
data/corrections.yml (pipeline.corrections), which is git-tracked and reviewable
as a diff, and rewrites data/catalog.json from it; the D1 row is then marked
with the commit that carried it. The published site can always be
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

from pipeline.corrections import CorrectionError, correct
from pipeline.corrections import write as write_corrections
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
    # A part's start and chant, a Vespers item's tone and chant: checked in full
    # by pipeline.corrections when recorded.
    "startSystem": re.compile(r"^\d{1,3}$"),
    "gregobaseId": re.compile(r"^(\d{1,6}|none)$"),
    "tone": re.compile(r"^[A-Za-z0-9.*]{1,12}$"),
    # "A part is missing or mislabelled": words naming a system, fixed by an
    # editor on the admin's Sections screen, never recorded from here.
    "sections": re.compile(r"^(?=.*\d)[^\x00-\x1f<>]{3,200}$"),
}

CATALOG_KEY = {
    "title": "title",
    "incipit": "incipit",
    "mode": "mode",
    "genre": "genre",
    "printedPages": "printed_pages",
    "chant": "chant",
    "startSystem": "start_system",
    "gregobaseId": "chant",
    "tone": "tone",
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
    #: A part or Vespers item (migration 0002); None for the piece itself.
    target: str | None = None


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


# `wrangler d1 execute` has no parameter binding, so this tool cannot meet the
# project's "parameterized queries only" rule literally. Every query therefore goes
# through _d1(sql, params) with `?` placeholders, and _sql_literal admits only
# integers, NULL, and strings matching a strict allowlist -- nothing a stranger
# wrote can reach the SQL. Literal compliance needs Cloudflare's D1 HTTP API,
# which binds params server-side but requires a D1-scoped API token.
SAFE_TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")


def _sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        raise TypeError("refusing to bind a boolean")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and SAFE_TOKEN.fullmatch(value):
        return "'" + value.replace("'", "''") + "'"
    raise ValueError(f"refusing to bind {value!r}: only ints, None and simple tokens")


def _bind(sql: str, params: tuple[object, ...]) -> str:
    parts = sql.split("?")
    if len(parts) - 1 != len(params):
        raise ValueError(f"{len(parts) - 1} placeholders but {len(params)} params")
    out = parts[0]
    for value, rest in zip(params, parts[1:]):
        out += _sql_literal(value) + rest
    return out


def _d1(sql: str, remote: bool, params: tuple[object, ...] = ()) -> list[dict[str, Any]]:
    output = _run(
        ["npx", "--yes", "wrangler@4", "d1", "execute", DATABASE,
         "--remote" if remote else "--local", "--json", "--command", _bind(sql, params)],
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
        "SELECT id, piece_id, target, field, proposed, note, status, created_at "
        "FROM corrections WHERE status = ? ORDER BY created_at",
        remote,
        ("pending",),
    )
    return [Correction(**row) for row in rows]


def mark(correction_id: int, status: str, commit_sha: str | None,
         remote: bool = True) -> None:
    if status not in {"accepted", "rejected"}:
        raise ValueError(f"refusing to set status {status!r}")
    if commit_sha is not None and not SHA.fullmatch(commit_sha):
        raise ValueError(f"refusing commit sha {commit_sha!r}")
    _d1(
        "UPDATE corrections SET status = ?, commit_sha = ? WHERE id = ?",
        remote,
        (status, commit_sha, int(correction_id)),
    )


def head_sha() -> str:
    sha = _run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT).strip()
    if not SHA.fullmatch(sha):
        raise RuntimeError(f"unexpected git sha {sha!r}")
    return sha


def catalog_is_committed() -> bool:
    """True when data/catalog.json has no uncommitted changes."""
    result = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", "data/catalog.json", "data/corrections.yml"],
        cwd=ROOT, check=False,
    )
    return result.returncode == 0


def stamp(remote: bool = True) -> int:
    """Record HEAD against accepted rows that do not yet carry a commit.

    Only meaningful immediately after committing the catalog, so it refuses to run
    while data/catalog.json has uncommitted changes -- otherwise it would stamp a
    commit that does not contain the correction.
    """
    if not catalog_is_committed():
        raise RuntimeError(
            "data/catalog.json or data/corrections.yml has uncommitted changes. Commit them first, then stamp."
        )
    sha = head_sha()
    _d1(
        "UPDATE corrections SET commit_sha = ? WHERE status = ? AND commit_sha IS NULL",
        remote,
        (sha, "accepted"),
    )
    return 0


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
    parser.add_argument("--stamp", action="store_true",
                        help="after committing the catalog, record HEAD against "
                             "accepted corrections")
    args = parser.parse_args(argv)
    remote = not args.local

    if args.stamp:
        return stamp(remote)

    catalog_path = DATA / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

    pending = fetch_pending(remote)
    if not pending:
        print("No pending corrections.")
        return 0

    print(f"{len(pending)} pending correction(s)\n")
    accepted: list[int] = []
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

        # Recorded in data/corrections.yml, never written into catalog.json:
        # the next `noh catalog` regenerates that file and would drop it.
        try:
            record(catalog, c)
        except (KeyError, RejectedCorrection, CorrectionError) as exc:
            print(f"    REFUSED   {exc}\n")
            mark(c.id, "rejected", None, remote)
            continue
        accepted.append(c.id)
        print("    recorded in data/corrections.yml\n")

    if accepted and not args.dry_run:
        # Write the files BEFORE marking rows. If marking then fails, the rows stay
        # pending and the next run records the same value again -- harmless. The
        # other order could mark a correction accepted that never reached the data.
        write_corrections(DATA / "catalog.base.json", DATA / "corrections.yml", DATA / "catalog.json")
        for correction_id in accepted:
            mark(correction_id, "accepted", None, remote)
        print(f"Recorded {len(accepted)} correction(s); data/catalog.json rewritten.")
        print("Commit, then record the commit against them:")
        print("  git add data/corrections.yml data/catalog.json && git commit -m 'data: apply corrections'")
        print("  uv run noh triage --stamp   (or: uv run triage --stamp)")
    return 0


def record(catalog: dict[str, Any], c: Correction) -> None:
    """A reader's correction as an entry in data/corrections.yml."""
    validate(c.field, c.proposed)
    if c.field == "sections":
        raise RejectedCorrection("a missing or mislabelled part is fixed on the admin's Sections screen "
                                 "(/admin/sections/), which writes the piece's whole list; see docs/EDITING.md, 'Sections'")
    if c.field == "chant" and not c.target:
        raise RejectedCorrection("a piece's chant pairing is corrected on its parts (Introit, Gradual...), "
                                 "not the piece; see docs/EDITING.md, 'Proper parts'")
    if c.target and not c.target.startswith("piece:"):
        target = c.target
    else:
        slug = next((p["slug"] for p in catalog.get("pieces", [])
                     if p.get("id") == c.piece_id or p.get("slug") == c.piece_id), None)
        if slug is None:
            raise KeyError(f"no piece with id or slug {c.piece_id!r}")
        target = f"piece:{slug}"
    correct(target, CATALOG_KEY[c.field], c.proposed, note=c.note[:200], source=f"reader#{c.id}",
            base_path=DATA / "catalog.base.json", path=DATA / "corrections.yml", vespers_dir=DATA)


if __name__ == "__main__":
    sys.exit(main())
