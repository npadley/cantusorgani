"""Hand corrections, applied over the generated catalogue (data/corrections.yml).

`noh catalog` reads the scans and writes data/catalog.base.json; this module
applies data/corrections.yml over it and writes data/catalog.json, which the
site reads. Applying needs no PDFs, so an editor without pdf-source/ -- and CI --
can land a correction.

Each entry records `was`, the generated value when the fix was made. If a later
catalogue run changes that value, the entry is stale and the build stops rather
than silently overwrite a value nobody has looked at.

Fix at the source when the source can express it (data/index-*.yml,
data/vespers-offices.yml). This overlay is for what the pipeline computes.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from pipeline.volumes import DATA

CORRECTIONS = DATA / "corrections.yml"
BASE = DATA / "catalog.base.json"
CATALOG = DATA / "catalog.json"

# Correctable fields of a piece, keyed as in the catalogue, from the schema the
# admin screen reads too. Free text refuses control characters and markup: the
# site escapes output, but a title with "<" in it is always a mistake.
SCHEMA = DATA / "schema" / "corrections.json"
_SPEC: dict[str, dict[str, Any]] = json.loads(SCHEMA.read_text(encoding="utf-8"))["targets"]["piece"]
FIELDS: dict[str, re.Pattern[str]] = {name: re.compile(rule["pattern"]) for name, rule in _SPEC.items()}
HINTS: dict[str, str] = {name: rule["hint"] for name, rule in _SPEC.items()}
ROMAN = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII")

HEADER = """\
# Hand corrections over the generated catalogue. Applied by `noh catalog` and
# `noh apply-corrections`; see docs/EDITING.md.
#
# Do not hand-write entries: `uv run noh correct <target> <field> <value>` fills
# in `id`, `was` and the date, and checks the value. `was` is what the pipeline
# generated when the fix was made; if it changes, the build stops and asks.
#
# Fields of a piece (target piece:<slug>): title, incipit, mode, genre,
# printed_pages. For example:
#
# - id: c-0001
#   target: piece:dominica-i-adventus
#   field: title
#   was: Dominica I Adventus
#   value: Dominica prima Adventus
#   source: editor
#   date: '2026-09-27'
#   note: as printed on p. 3
"""


class CorrectionError(ValueError):
    """One or more corrections cannot be applied; each line names its fix."""


@dataclass
class Entry:
    id: str
    target: str
    field: str
    was: Any
    value: Any
    source: str = "editor"
    date: str = ""
    note: str = ""
    editor_email: str = ""
    line: int = field(default=0, compare=False)

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "target": self.target, "field": self.field,
                               "was": self.was, "value": self.value, "source": self.source,
                               "date": self.date}
        if self.note:
            out["note"] = self.note
        if self.editor_email:
            out["editor_email"] = self.editor_email
        return out


def _where(entry: Entry) -> str:
    return f"corrections.yml:{entry.line} ({entry.id})" if entry.line else f"corrections.yml ({entry.id})"


def load(path: Path = CORRECTIONS) -> list[Entry]:
    """The entries in file order, each with the line it starts on."""
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    node = yaml.compose(text)
    docs = yaml.safe_load(text) or []
    if not isinstance(docs, list):
        raise CorrectionError("corrections.yml: expected a list of entries; see the example at the top of the file")
    lines = [n.start_mark.line + 1 for n in node.value] if node is not None else []
    entries = []
    for n, raw in enumerate(docs):
        line = lines[n] if n < len(lines) else 0
        if not isinstance(raw, dict) or not {"id", "target", "field", "value"} <= set(raw):
            raise CorrectionError(f"corrections.yml:{line}: an entry needs id, target, field and value; "
                                  "try `uv run noh correct` instead of writing it by hand")
        entries.append(Entry(id=str(raw["id"]), target=str(raw["target"]), field=str(raw["field"]),
                             was=raw.get("was"), value=raw["value"], source=str(raw.get("source", "editor")),
                             date=str(raw.get("date", "")), note=str(raw.get("note", "")),
                             editor_email=str(raw.get("editor_email", "")), line=line))
    return entries


def save(entries: list[Entry], path: Path = CORRECTIONS) -> Path:
    body = yaml.safe_dump([e.as_dict() for e in entries], sort_keys=False, allow_unicode=True, width=100)
    path.write_text(HEADER + ("\n" + body if entries else ""), encoding="utf-8")
    return path


def coerce(name: str, value: object, genre: str | None = None) -> Any:
    """A value as the catalogue stores it; raises CorrectionError naming the rule.

    `genre` is the piece's, where known: some fields do not apply to some genres
    (a Proper has no single mode)."""
    if name not in FIELDS:
        raise CorrectionError(f"unknown field {name!r}; a piece's correctable fields are {', '.join(FIELDS)}")
    rule = _SPEC[name]
    if genre is not None and genre in (rule.get("not_for_genres") or {}):
        raise CorrectionError(str(rule["not_for_genres"][genre]))
    if name == "printed_pages" and isinstance(value, list) and len(value) == 2:
        value = f"{value[0]}-{value[1]}"
    text = str(value).strip()
    if rule.get("arabic_to_roman") and text.isdigit() and 1 <= int(text) <= len(ROMAN):
        text = ROMAN[int(text) - 1]
    if not FIELDS[name].fullmatch(text):
        raise CorrectionError(f"{text!r} is not a valid {name}: expected {HINTS[name]}")
    if sum(ch.isalpha() for ch in text) < int(rule.get("min_letters", 0)):
        raise CorrectionError(f"{text!r} is not a valid {name}: expected {HINTS[name]}")
    if name == "printed_pages":
        first, last = (int(p) for p in text.split("-", 1))
        if first > last:
            raise CorrectionError(f"page range {text!r} runs backwards")
        return [first, last]
    return text


def _pieces(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(p["slug"]): p for p in catalog.get("pieces", [])}


def _piece(target: str, pieces: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    kind, _, slug = target.partition(":")
    return pieces.get(slug) if kind == "piece" else None


def problems(base: dict[str, Any], entries: list[Entry]) -> list[str]:
    """Every reason the entries cannot be applied to `base`, one line each."""
    pieces = _pieces(base)
    genres = {str(p.get("genre")) for p in pieces.values()}
    seen: dict[tuple[str, str], str] = {}
    ids: set[str] = set()
    out = []
    for e in entries:
        where = _where(e)
        if e.id in ids:
            out.append(f"{where}: the id {e.id} is used twice; give one entry a new id")
        ids.add(e.id)
        if not e.target.startswith("piece:"):
            out.append(f"{where}: {e.target} is not a target this file can correct yet; "
                       "use piece:<slug> (run `uv run noh where <page URL>` to find it)")
            continue
        piece = _piece(e.target, pieces)
        if piece is None:
            out.append(f"{where}: {e.target} no longer exists; run `uv run noh where "
                       f"\"{e.target.partition(':')[2].replace('-', ' ')}\"` to see current slugs, "
                       "then update or delete this entry")
            continue
        key = (e.target, e.field)
        if key in seen:
            out.append(f"{where}: {e.target} {e.field} is already corrected by {seen[key]}; "
                       "keep one entry and delete the other")
            continue
        seen[key] = e.id
        try:
            value = coerce(e.field, e.value, str(piece.get("genre")))
        except CorrectionError as exc:
            out.append(f"{where}: {e.target} {exc}")
            continue
        if e.field == "genre" and value not in genres:
            out.append(f"{where}: {e.target} genre {value!r} is not one the catalogue uses "
                       f"({', '.join(sorted(genres))})")
            continue
        if piece.get(e.field) != e.was:
            out.append(f"{where}: stale correction: {e.target} {e.field} was {e.was!r} when the fix "
                       f"was made but the catalogue now says {piece.get(e.field)!r}; check the new value, "
                       "then set `was` to it or delete this entry (`uv run noh corrections --drop "
                       f"{e.id}`)")
    return out


def apply(base: dict[str, Any], entries: list[Entry]) -> dict[str, Any]:
    """A new catalogue with every entry applied; raises if any cannot be."""
    found = problems(base, entries)
    if found:
        raise CorrectionError("\n".join(found))
    catalog = copy.deepcopy(base)
    pieces = _pieces(catalog)
    for e in entries:
        piece = _piece(e.target, pieces)
        assert piece is not None
        piece[e.field] = coerce(e.field, e.value, str(piece.get("genre")))
    return catalog


def no_ops(base: dict[str, Any], entries: list[Entry]) -> list[Entry]:
    """Entries whose value the generated catalogue now has anyway: fixed at the
    source, so they can be deleted."""
    pieces = _pieces(base)
    out = []
    for e in entries:
        piece = _piece(e.target, pieces)
        try:
            if piece is not None and piece.get(e.field) == coerce(e.field, e.value):
                out.append(e)
        except CorrectionError:
            continue
    return out


def dump(catalog: dict[str, Any]) -> str:
    return json.dumps(catalog, indent=2) + "\n"


def load_base(path: Path = BASE) -> dict[str, Any]:
    if not path.exists():
        raise CorrectionError(f"{path.name} is missing; run `uv run noh catalog --volume <vol>` "
                              "(needs pdf-source/) or restore it with `git checkout data/catalog.base.json`")
    return json.loads(path.read_text(encoding="utf-8"))


def write(base_path: Path = BASE, path: Path = CORRECTIONS, out: Path = CATALOG) -> tuple[Path, int, bool]:
    """Apply the overlay and write catalog.json; returns (path, entries, changed)."""
    base = load_base(base_path)
    entries = load(path)
    text = dump(apply(base, entries))
    changed = not out.exists() or out.read_text(encoding="utf-8") != text
    if changed:
        out.write_text(text, encoding="utf-8")
    return out, len(entries), changed


def next_id(entries: list[Entry]) -> str:
    numbers = [int(m.group(1)) for e in entries if (m := re.fullmatch(r"c-(\d+)", e.id))]
    return f"c-{max(numbers, default=0) + 1:04d}"


def correct(target: str, name: str, value: str, note: str = "", source: str = "editor",
            editor_email: str = "", today: date | None = None, base_path: Path = BASE,
            path: Path = CORRECTIONS) -> tuple[Entry, bool]:
    """Record one correction; returns (entry, replaced an earlier one)."""
    base = load_base(base_path)
    piece = _piece(target, _pieces(base))
    if piece is None:
        raise CorrectionError(f"{target} is not a piece in the catalogue; run `uv run noh where "
                              "<page URL>` to find the target")
    new = coerce(name, value, str(piece.get("genre")))
    if new == piece.get(name):
        raise CorrectionError(f"{target} {name} is already {new!r}; nothing to correct")
    entries = load(path)
    stamp = (today or datetime.now(UTC).date()).isoformat()
    for e in entries:
        if (e.target, e.field) == (target, name):
            e.value, e.note, e.source, e.date = new, note or e.note, source, stamp
            e.editor_email = editor_email or e.editor_email
            _check_and_save(base, entries, path)
            return e, True
    entry = Entry(id=next_id(entries), target=target, field=name, was=piece.get(name), value=new,
                  source=source, date=stamp, note=note, editor_email=editor_email)
    _check_and_save(base, [*entries, entry], path)
    return entry, False


def _check_and_save(base: dict[str, Any], entries: list[Entry], path: Path) -> None:
    found = problems(base, entries)
    if found:
        raise CorrectionError("\n".join(found))
    save(entries, path)


BATCH_ID = re.compile(r"^b-[0-9a-z-]{6,40}$")
EMAIL = re.compile(r"^[^\s@<>]{1,64}@[^\s@<>]{1,190}$")


def correct_batch(batch: dict[str, Any], today: date | None = None, base_path: Path = BASE,
                  path: Path = CORRECTIONS) -> list[Entry]:
    """Record a batch from the admin screen, all or nothing.

    The batch arrives from GitHub Actions' repository_dispatch payload, so every
    field is checked here again, whatever the admin screen already checked."""
    batch_id = str(batch.get("batch", ""))
    if not BATCH_ID.fullmatch(batch_id):
        raise CorrectionError(f"batch id {batch_id!r} is not of the form b-<letters, digits, ->")
    items = batch.get("entries")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise CorrectionError("a batch needs 1 to 100 entries")
    before = path.read_text(encoding="utf-8") if path.exists() else None
    done: list[Entry] = []
    errors: list[str] = []
    for n, item in enumerate(items, 1):
        if not isinstance(item, dict):
            errors.append(f"entry {n}: not an object")
            continue
        source = str(item.get("source", "editor"))
        email = str(item.get("editor_email", ""))
        if not re.fullmatch(r"editor|reader#\d{1,9}", source):
            errors.append(f"entry {n}: source {source!r} must be editor or reader#<id>")
            continue
        if email and not EMAIL.fullmatch(email):
            errors.append(f"entry {n}: editor_email {email!r} is not an address")
            continue
        try:
            entry, _ = correct(str(item.get("target", "")), str(item.get("field", "")), str(item.get("value", "")),
                               note=str(item.get("note", ""))[:200], source=source, editor_email=email,
                               today=today, base_path=base_path, path=path)
            done.append(entry)
        except CorrectionError as exc:
            errors.append(f"entry {n} ({item.get('target')} {item.get('field')}): {exc}")
    if errors:
        if before is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(before, encoding="utf-8")
        raise CorrectionError(f"batch {batch_id}: nothing was recorded.\n" + "\n".join(errors))
    return done


def batch_summary(batch_id: str, entries: list[Entry]) -> str:
    """The pull request's description: one line per correction, for review."""
    lines = [f"Corrections from the admin screen, batch `{batch_id}`.", "",
             "| Id | Target | Field | Was | Now | By | Note |", "|---|---|---|---|---|---|---|"]
    for e in entries:
        cells = [e.id, e.target, e.field, json.dumps(e.was, ensure_ascii=False), json.dumps(e.value, ensure_ascii=False),
                 e.editor_email or e.source, e.note]
        lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    lines += ["", "Merging deploys the site. Closing without merging returns these to the admin queue."]
    return "\n".join(lines) + "\n"


def drop(entry_id: str, path: Path = CORRECTIONS) -> Entry:
    entries = load(path)
    for e in entries:
        if e.id == entry_id:
            save([x for x in entries if x.id != entry_id], path)
            return e
    raise CorrectionError(f"no correction {entry_id} in corrections.yml; ids: "
                          f"{', '.join(e.id for e in entries) or 'none'}")


# ------------------------------------------------------------------- where ---

@dataclass(frozen=True)
class Location:
    target: str
    label: str
    source: str
    command: str


def _line_of(path: Path, needle: str) -> int:
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if needle in line:
            return n
    return 0


def where(query: str, catalog: dict[str, Any], data: Path = DATA) -> list[Location]:
    """What a page URL (or a few words of a title) is, and where to fix it."""
    path = urlparse(query).path if "/" in query else ""
    parts = [p for p in path.split("/") if p]
    pieces = _pieces(catalog)
    if len(parts) >= 2 and parts[0] == "piece" and parts[1] in pieces:
        return [_piece_location(pieces[parts[1]], data)]
    if parts and parts[0] == "vespers" and len(parts) >= 2:
        vespers = "I" if len(parts) > 2 and parts[2] == "i" else "II"
        return [_vespers_location(parts[1], vespers, data)]
    if len(parts) >= 3 and parts[0] == "day":
        key = f"{parts[1]}:{parts[2]}"
        return [Location(f"day:{key}", f"the day {key}",
                         "data/rubrics-1962.yml (a day taking another day's Mass); data/index-noh*.yml "
                         "(the `days` a piece is sung on)", "uv run noh catalog --volume <vol>")]
    words = [w for w in re.split(r"[\s/-]+", query.lower()) if w]
    hits = [p for p in pieces.values()
            if words and all(w in f"{p['slug']} {p.get('title') or ''} {p.get('incipit') or ''}".lower()
                             for w in words)]
    return [_piece_location(p, data) for p in hits[:20]]


def _vespers_location(day: str, vespers: str, data: Path) -> Location:
    """The office a Vespers page is built from, and the line that holds it."""
    target = f"vespers:{day}/{vespers}"
    general = ("data/vespers-offices.yml (a feast's antiphons, tones, hymn); data/vespers-noh8.yml "
               "(the Sunday psalter, Magnificat antiphons, seasons, tone bank)")
    command = f"uv run noh vespers-lineup, then check: uv run noh vespers-lineup --day {day}"
    lineup_path = data / "vespers-lineup.json"
    if not lineup_path.exists():
        return Location(target, f"{vespers} Vespers of {day}", general, command)
    lineup = json.loads(lineup_path.read_text(encoding="utf-8"))
    entry = (lineup.get("first_vespers" if vespers == "I" else "days") or {}).get(day)
    if not entry:
        return Location(target, f"no {vespers} Vespers page for {day}", general, command)
    office = str(entry.get("office"))
    sung = str(entry.get("vespers", vespers))
    offices_path = data / "vespers-offices.yml"
    doc = yaml.safe_load(offices_path.read_text(encoding="utf-8")) if offices_path.exists() else {}
    for name, spec in ((doc or {}).get("offices") or {}).items():
        if office in (spec.get("keys") or []) and str(spec.get("vespers")) == sung:
            line = _line_of(offices_path, f"  {name}:")
            return Location(target, f"{sung} Vespers of {office} (office {name})",
                            f"data/vespers-offices.yml:{line}", command)
    noh8 = data / "vespers-noh8.yml"
    line = _line_of(noh8, f"{office}:") if noh8.exists() else 0
    source = (f"data/vespers-noh8.yml:{line} (this Sunday's Magnificat antiphon; the psalter and "
              "seasons are in the same file)") if line else general
    return Location(target, f"{sung} Vespers of {office}", source, command)


def _piece_location(piece: dict[str, Any], data: Path) -> Location:
    index = data / f"index-{piece['volume']}.yml"
    line = _line_of(index, f"slug: {piece['slug']}") if index.exists() else 0
    source = f"{index.relative_to(data.parent)}:{line}" if line else f"data/index-{piece['volume']}.yml"
    return Location(f"piece:{piece['slug']}", f"{piece.get('title')} ({piece['volume']}, pp. "
                    f"{'-'.join(str(n) for n in piece.get('printed_pages') or [])})",
                    source, f"uv run noh correct piece:{piece['slug']} <field> <value>")


__all__ = ["BASE", "CATALOG", "CORRECTIONS", "FIELDS", "CorrectionError", "Entry", "Location", "apply",
           "batch_summary", "coerce", "correct", "correct_batch", "drop", "load", "load_base", "no_ops", "problems", "save", "where", "write"]
