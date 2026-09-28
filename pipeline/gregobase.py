"""GregoBase ingest and incipit matching.

GregoBase (https://gregobase.selapa.net) publishes chant as GABC — notation
source, not images — so a paired chant can be engraved fresh beside the 1942
accompaniment. GregoBase releases its transcriptions under CC0; see
data/LICENSES.md.

The dump carries a `copyrighted` flag (a transcription from a modern edition
still in copyright). Rows with it set are never published.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from pipeline.volumes import ROOT

DUMP = ROOT / "vendor" / "gregobase_online.sql"
DUMP_SHA256 = "3759c60b529b57fa13f696bfacf748d40a285a847d859276667749caa76de080"
# The commit of gregorio-project/GregoBase whose dump has that sha256 (its last
# change to the file, 2024-01-05): `noh gregobase-fetch` downloads exactly it.
DUMP_COMMIT = "2ebcda3f523f9b19933d59fa32bb4215cd8e7675"
DUMP_URL = f"https://raw.githubusercontent.com/gregorio-project/GregoBase/{DUMP_COMMIT}/gregobase_online.sql"


class DumpError(ValueError):
    """The GregoBase dump could not be fetched, or is not the pinned one."""


def fetch_dump(path: Path = DUMP, url: str = DUMP_URL, pinned: str = DUMP_SHA256) -> Path:
    """Download the pinned dump (CC0) and check it against DUMP_SHA256 before
    it replaces anything: a changed file is refused, never used."""
    import hashlib
    import urllib.request

    with urllib.request.urlopen(url, timeout=120) as response:
        body = response.read()
    digest = hashlib.sha256(body).hexdigest()
    if digest != pinned:
        raise DumpError(f"the dump at {url} has sha256 {digest}, not the pinned {pinned}; "
                        "nothing was written. Check GregoBase's history before moving the pin")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)
    return path

# Column order of gregobase_chants in the dump, as declared by its CREATE TABLE.
COLUMNS = (
    "id", "cantusid", "version", "incipit", "initial", "office-part", "mode",
    "mode_var", "transcriber", "commentary", "headers", "gabc", "gabc_verses",
    "tex_verses", "remarks", "copyrighted", "duplicateof",
)

_WORDS = re.compile(r"[^a-z ]+")


@dataclass(frozen=True)
class Chant:
    id: int
    incipit: str
    office_part: str | None
    mode: str | None
    gabc: str | None
    cantusid: str | None


def normalise_incipit(text: str) -> str:
    """Accent-strip, lowercase, drop punctuation, collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(_WORDS.sub(" ", ascii_only.lower()).split())


def match_score(a: str, b: str) -> float:
    """Similarity of two normalised incipits, in [0, 1]."""
    if not a or not b:
        return 0.0
    return round(SequenceMatcher(None, a, b).ratio(), 3)


def _split_values(blob: str) -> list[list[str | None]]:
    """Split a MySQL VALUES blob into rows of raw fields.

    Hand-written because the dump is 17 MB of multi-row INSERTs containing GABC
    with commas, quotes and backslashes; a naive split on "," destroys it.
    Unquoted NULL must become None rather than the four-character string "NULL",
    which is subtle enough to have silently dropped every row on the first pass.
    """
    rows: list[list[str | None]] = []
    row: list[str | None] = []
    field: list[str] = []
    in_string = False
    escaped = False
    quoted = False
    depth = 0

    def close_field() -> None:
        text = "".join(field)
        if not quoted and text.strip().upper() == "NULL":
            row.append(None)
        else:
            row.append(text)

    for ch in blob:
        if in_string:
            if escaped:
                field.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0"}.get(ch, ch))
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == "'":
                in_string = False
            else:
                field.append(ch)
            continue
        if ch == "'":
            in_string = quoted = True
        elif ch == "(":
            depth += 1
            if depth == 1:
                row, field, quoted = [], [], False
        elif ch == ")" and depth == 1:
            depth = 0
            close_field()
            rows.append(row)
        elif ch == "," and depth == 1:
            close_field()
            field, quoted = [], False
        elif depth == 1 and not ch.isspace():
            field.append(ch)
    return rows


def load_chant_rows(dump: Path = DUMP) -> list[tuple[Chant, bool]]:
    """Every chant with its `copyrighted` flag, duplicates and chants with no
    incipit left out. Callers decide what to do with the flag."""
    text = dump.read_text(encoding="utf-8", errors="replace")
    idx = {name: i for i, name in enumerate(COLUMNS)}
    rows_out: list[tuple[Chant, bool]] = []
    for match in re.finditer(r"INSERT INTO `gregobase_chants`[^\n]*?VALUES\s*", text):
        start = match.end()
        end = text.find(";\n", start)
        for row in _split_values(text[start:end if end != -1 else len(text)]):
            if len(row) != len(COLUMNS):
                continue
            if row[idx["duplicateof"]] not in (None, "", "0"):
                continue
            incipit = row[idx["incipit"]] or ""
            if not incipit.strip():
                continue
            rows_out.append((Chant(
                id=int(row[idx["id"]] or 0),
                incipit=incipit,
                office_part=row[idx["office-part"]],
                mode=row[idx["mode"]],
                gabc=row[idx["gabc"]],
                cantusid=row[idx["cantusid"]],
            ), (row[idx["copyrighted"]] or "0") != "0"))
    return rows_out


def load_chants(dump: Path = DUMP, include_copyrighted: bool = False) -> list[Chant]:
    return [chant for chant, copyrighted in load_chant_rows(dump)
            if include_copyrighted or not copyrighted]
