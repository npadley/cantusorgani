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
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import yaml

from pipeline.volumes import DATA

CORRECTIONS = DATA / "corrections.yml"
BASE = DATA / "catalog.base.json"
CATALOG = DATA / "catalog.json"
#: The public corrections log (/corrections/log/): what changed and when, no addresses.
LOG = DATA / "corrections-log.json"

# What each kind of target may correct, from the schema the admin screen and the
# Corrections form read too. Free text refuses control characters and markup:
# the site escapes output, but a title with "<" in it is always a mistake.
SCHEMA = DATA / "schema" / "corrections.json"
_SCHEMA: dict[str, Any] = json.loads(SCHEMA.read_text(encoding="utf-8"))
_SPECS: dict[str, dict[str, dict[str, Any]]] = _SCHEMA["targets"]
_SPEC = _SPECS["piece"]
FIELDS: dict[str, re.Pattern[str]] = {name: re.compile(rule["pattern"]) for name, rule in _SPEC.items()}
HINTS: dict[str, str] = {name: rule["hint"] for name, rule in _SPEC.items()}
ROMAN = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII")
PARTS = ("introit", "gradual", "alleluia", "tract", "sequence", "offertory", "communion")

HEADER = """\
# Hand corrections over the generated catalogue. Applied by `noh catalog` and
# `noh apply-corrections`; see docs/EDITING.md.
#
# Do not hand-write entries: `uv run noh correct <target> <field> <value>` fills
# in `id`, `was` and the date, and checks the value. `was` is what the pipeline
# generated when the fix was made; if it changes, the build stops and asks.
#
# Targets and their fields:
#   piece:<slug>                          title, incipit, mode, genre, printed_pages
#   part:<slug>/<part>[:<variant>]        start_system (counting from 1), chant
#   vespers:<office>/antiphon-<n>         tone, chant   (an office of vespers-offices.yml)
#   vespers:<office>/magnificat           tone, chant
#   vespers:sunday:<key>/magnificat       tone, chant   (vespers-noh8.yml magnificat_antiphons)
# A chant is a GregoBase id, or none. For example:
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


def kind_of(target: str) -> str:
    """piece, part or vespers; raises for anything else."""
    kind = target.partition(":")[0]
    if kind not in _SPECS:
        raise CorrectionError(f"{target} is not a target this file can correct; targets are "
                              f"{'; '.join(_SCHEMA['targets_help'].values())}")
    return kind


def coerce(name: str, value: object, genre: str | None = None, kind: str = "piece") -> Any:
    """A value as the data stores it; raises CorrectionError naming the rule.

    `genre` is the piece's, where known: some fields do not apply to some genres
    (a Proper has no single mode)."""
    spec = _SPECS[kind]
    if name not in spec:
        raise CorrectionError(f"unknown field {name!r}; the correctable fields of a {kind} are {', '.join(spec)}")
    rule = spec[name]
    if genre is not None and genre in (rule.get("not_for_genres") or {}):
        raise CorrectionError(str(rule["not_for_genres"][genre]))
    if name == "printed_pages" and isinstance(value, list) and len(value) == 2:
        value = f"{value[0]}-{value[1]}"
    text = "none" if value is None and name == "chant" else str(value).strip()
    if rule.get("arabic_to_roman") and text.isdigit() and 1 <= int(text) <= len(ROMAN):
        text = ROMAN[int(text) - 1]
    if not re.fullmatch(rule["pattern"], text) or sum(ch.isalpha() for ch in text) < int(rule.get("min_letters", 0)):
        raise CorrectionError(f"{text!r} is not a valid {name}: expected {rule['hint']}")
    if name == "printed_pages":
        first, last = (int(p) for p in text.split("-", 1))
        if first > last:
            raise CorrectionError(f"page range {text!r} runs backwards")
        return [first, last]
    if name == "chant":
        return None if text == "none" else int(text)
    if name == "start_system":
        return int(text)
    return text


@dataclass
class Slot:
    """Where one correctable value lives: how to read it, write it, and what
    else it must satisfy (a part's start must stay between its neighbours)."""
    get: Callable[[], Any]
    put: Callable[[Any], None]
    genre: str | None = None
    check: Callable[[Any], str | None] | None = None


@dataclass
class VespersData:
    """The reviewed Vespers files, as loaded: the overlay's vespers targets."""
    doc: dict[str, Any]
    offices: dict[str, Any]


def load_vespers(data: Path = DATA) -> VespersData:
    doc = yaml.safe_load((data / "vespers-noh8.yml").read_text(encoding="utf-8")) or {}
    offices_path = data / "vespers-offices.yml"
    offices = (yaml.safe_load(offices_path.read_text(encoding="utf-8")) or {}).get("offices", {}) \
        if offices_path.exists() else {}
    return VespersData(doc, offices)


def _pieces(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(p["slug"]): p for p in catalog.get("pieces", [])}


def _piece(target: str, pieces: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    kind, _, slug = target.partition(":")
    return pieces.get(slug) if kind == "piece" else None


def _gone(target: str) -> CorrectionError:
    words = target.split(":", 1)[-1].split("/")[0].replace("-", " ")
    return CorrectionError(f"{target} no longer exists; run `uv run noh where \"{words}\"` to see current "
                           "targets, then update or delete this entry")


def _part_slot(target: str, name: str, pieces: dict[str, dict[str, Any]]) -> Slot:
    m = re.fullmatch(r"part:([a-z0-9-]+)/([a-z]+)(?::([a-z0-9-]+))?", target)
    if not m:
        raise CorrectionError(f"{target} is not of the form part:<slug>/<part>[:<variant>]")
    slug, part, variant = m.group(1), m.group(2), m.group(3) or ""
    piece = pieces.get(slug)
    parts = piece.get("parts") or [] if piece else []
    found = next((p for p in parts if p.get("part") == part and (p.get("variant") or "") == variant), None)
    if piece is None or found is None:
        raise _gone(target)
    systems: list[str] = piece.get("systems") or []
    if name == "chant":
        return Slot(get=lambda: found.get("gregobase_id"), put=lambda v: found.__setitem__("gregobase_id", v))
    if "system" not in found:
        raise CorrectionError(f"{target} is printed in another volume ({found.get('borrowed_from', 'elsewhere')}); "
                              "correct it where it is printed")

    def check(n: Any) -> str | None:
        if not 1 <= int(n) <= len(systems):
            return f"{target} start_system {n} is outside the piece, which has {len(systems)} systems"
        placed = [p for p in parts if "system" in p]
        at = placed.index(found)
        before = placed[at - 1]["system"] + 1 if at > 0 else 0
        after = placed[at + 1]["system"] + 1 if at + 1 < len(placed) else len(systems) + 1
        if not before < int(n) < after:
            return (f"{target} start_system {n} would put it out of order: it must come after system "
                    f"{before} and before system {after}")
        return None

    def put(n: Any) -> None:
        found.update(system=int(n) - 1, ref=systems[int(n) - 1], placed="hand", score=1.0)

    return Slot(get=lambda: found["system"] + 1, put=put, check=check)


def _vespers_slot(target: str, name: str, data: VespersData) -> Slot:
    head, _, item = target.rpartition("/")
    office = head.split(":", 1)[1] if ":" in head else ""
    entry: dict[str, Any] | None = None
    if office.startswith("sunday:") and item == "magnificat":
        entry = (data.doc.get("magnificat_antiphons") or {}).get(office.split(":", 1)[1])
    elif office in data.offices:
        o = data.offices[office]
        if item == "magnificat" and isinstance(o.get("magnificat"), dict):
            entry = o["magnificat"]
        elif m := re.fullmatch(r"antiphon-(\d)", item):
            entry = next((a for a in o.get("antiphons") or [] if a.get("n") == int(m.group(1))), None)
    if entry is None:
        raise _gone(target)
    return Slot(get=lambda: entry.get(name), put=lambda v: entry.__setitem__(name, v))


def slot(target: str, name: str, catalog: dict[str, Any] | None, vespers: VespersData | None) -> Slot:
    """The slot a target's field names; raises CorrectionError saying why not."""
    kind = kind_of(target)
    if name not in _SPECS[kind]:
        raise CorrectionError(f"unknown field {name!r}; the correctable fields of a {kind} are "
                              f"{', '.join(_SPECS[kind])}")
    if kind == "vespers":
        if vespers is None:
            raise CorrectionError(f"{target}: the Vespers files are not loaded")
        return _vespers_slot(target, name, vespers)
    pieces = _pieces(catalog or {})
    if kind == "part":
        return _part_slot(target, name, pieces)
    piece = _piece(target, pieces)
    if piece is None:
        raise _gone(target)
    return Slot(get=lambda: piece.get(name), put=lambda v: piece.__setitem__(name, v), genre=str(piece.get("genre")))


def problems(base: dict[str, Any] | None, entries: list[Entry], vespers: VespersData | None = None) -> list[str]:
    """Every reason the entries cannot be applied, one line each. Entries of a
    kind whose data is not given (vespers without `vespers`, pieces and parts
    without `base`) are left to the call that has it."""
    genres = {str(p.get("genre")) for p in _pieces(base or {}).values()}
    seen: dict[tuple[str, str], str] = {}
    ids: set[str] = set()
    out = []
    for e in entries:
        where = _where(e)
        if e.id in ids:
            out.append(f"{where}: the id {e.id} is used twice; give one entry a new id")
        ids.add(e.id)
        try:
            kind = kind_of(e.target)
        except CorrectionError as exc:
            out.append(f"{where}: {exc}")
            continue
        if (kind == "vespers" and vespers is None) or (kind != "vespers" and base is None):
            continue
        key = (e.target, e.field)
        if key in seen:
            out.append(f"{where}: {e.target} {e.field} is already corrected by {seen[key]}; "
                       "keep one entry and delete the other")
            continue
        seen[key] = e.id
        try:
            s = slot(e.target, e.field, base, vespers)
            value = coerce(e.field, e.value, s.genre, kind)
        except CorrectionError as exc:
            out.append(f"{where}: {exc}" if str(exc).startswith(e.target) else f"{where}: {e.target} {exc}")
            continue
        if e.field == "genre" and value not in genres:
            out.append(f"{where}: {e.target} genre {value!r} is not one the catalogue uses "
                       f"({', '.join(sorted(genres))})")
            continue
        if e.field == "tone" and value not in _SCHEMA["tones"]:
            out.append(f"{where}: {e.target} tone {value!r} is not one NOH8 prints")
            continue
        if s.get() != e.was:
            out.append(f"{where}: stale correction: {e.target} {e.field} was {e.was!r} when the fix "
                       f"was made but the data now says {s.get()!r}; check the new value, "
                       "then set `was` to it or delete this entry (`uv run noh corrections --drop "
                       f"{e.id}`)")
            continue
        issue = s.check(value) if s.check else None
        if issue:
            out.append(f"{where}: {issue}")
    return out


def apply(base: dict[str, Any], entries: list[Entry]) -> dict[str, Any]:
    """A new catalogue with every piece and part entry applied; raises if any
    cannot be. Vespers entries are applied when the Vespers files load."""
    found = problems(base, entries)
    if found:
        raise CorrectionError("\n".join(found))
    catalog = copy.deepcopy(base)
    for e in entries:
        if kind_of(e.target) != "vespers":
            s = slot(e.target, e.field, catalog, None)
            s.put(coerce(e.field, e.value, s.genre, kind_of(e.target)))
    return catalog


def apply_vespers(data: VespersData, entries: list[Entry]) -> VespersData:
    """The Vespers files with every vespers entry applied; raises if any cannot be."""
    found = problems(None, entries, data)
    if found:
        raise CorrectionError("\n".join(found))
    out = VespersData(copy.deepcopy(data.doc), copy.deepcopy(data.offices))
    for e in entries:
        if kind_of(e.target) == "vespers":
            slot(e.target, e.field, None, out).put(coerce(e.field, e.value, None, "vespers"))
    return out


def no_ops(base: dict[str, Any], entries: list[Entry], vespers: VespersData | None = None) -> list[Entry]:
    """Entries whose value the generated data now has anyway: fixed at the
    source, so they can be deleted."""
    out = []
    for e in entries:
        try:
            kind = kind_of(e.target)
            if kind == "vespers" and vespers is None:
                continue
            s = slot(e.target, e.field, base, vespers)
            if s.get() == coerce(e.field, e.value, s.genre, kind):
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


def log_text(entries: list[Entry]) -> str:
    """The public log: each correction's target, field, old and new value, date
    and whether a reader or an editor made it. Never an address or a note."""
    rows = [{"id": e.id, "target": e.target, "field": e.field, "was": e.was, "value": e.value, "date": e.date,
             "by": "reader" if e.source.startswith("reader") else "editor"} for e in reversed(entries)]
    return json.dumps({"schema_version": 1, "corrections": rows}, indent=2, ensure_ascii=False) + "\n"


def _outputs(base_path: Path, path: Path, out: Path) -> dict[Path, str]:
    """Every file the corrections produce, with its text."""
    from pipeline.vespers import LINEUP, lineup_anchor, lineup_text
    entries = load(path)
    return {out: dump(apply(load_base(base_path), entries)), LINEUP: lineup_text(today=lineup_anchor()),
            LOG: log_text(entries)}


def write_all(base_path: Path = BASE, path: Path = CORRECTIONS, out: Path = CATALOG) -> tuple[int, list[str]]:
    """Apply every correction: catalog.json, the Vespers lineup (rebuilt for the
    window it already covers) and the public log. Returns (entries, files changed)."""
    files = []
    for file, text in _outputs(base_path, path, out).items():
        if not file.exists() or file.read_text(encoding="utf-8") != text:
            file.write_text(text, encoding="utf-8")
            files.append(file.name)
    return len(load(path)), files


def stale_outputs(base_path: Path = BASE, path: Path = CORRECTIONS, out: Path = CATALOG) -> list[str]:
    """The generated files that are not current with the corrections (for CI)."""
    return [f.name for f, text in _outputs(base_path, path, out).items()
            if not f.exists() or f.read_text(encoding="utf-8") != text]


def next_id(entries: list[Entry]) -> str:
    numbers = [int(m.group(1)) for e in entries if (m := re.fullmatch(r"c-(\d+)", e.id))]
    return f"c-{max(numbers, default=0) + 1:04d}"


def correct(target: str, name: str, value: str, note: str = "", source: str = "editor",
            editor_email: str = "", today: date | None = None, base_path: Path = BASE,
            path: Path = CORRECTIONS, vespers_dir: Path = DATA) -> tuple[Entry, bool]:
    """Record one correction; returns (entry, replaced an earlier one)."""
    kind = kind_of(target)
    base = load_base(base_path) if kind != "vespers" else None
    vespers = load_vespers(vespers_dir) if kind == "vespers" else None
    try:
        s = slot(target, name, base, vespers)
    except CorrectionError as exc:
        raise CorrectionError(f"{exc}. Run `uv run noh where <page URL>` to find the target") from None
    new = coerce(name, value, s.genre, kind)
    if new == s.get():
        raise CorrectionError(f"{target} {name} is already {new!r}; nothing to correct")
    issue = s.check(new) if s.check else None
    if issue:
        raise CorrectionError(issue)
    entries = load(path)
    stamp = (today or datetime.now(UTC).date()).isoformat()
    for e in entries:
        if (e.target, e.field) == (target, name):
            e.value, e.note, e.source, e.date = new, note or e.note, source, stamp
            e.editor_email = editor_email or e.editor_email
            _check_and_save(base, entries, path, vespers)
            return e, True
    entry = Entry(id=next_id(entries), target=target, field=name, was=s.get(), value=new,
                  source=source, date=stamp, note=note, editor_email=editor_email)
    _check_and_save(base, [*entries, entry], path, vespers)
    return entry, False


def _check_and_save(base: dict[str, Any] | None, entries: list[Entry], path: Path,
                    vespers: VespersData | None = None) -> None:
    found = problems(base, entries, vespers)
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


__all__ = [
    "BASE",
    "CATALOG",
    "CORRECTIONS",
    "FIELDS",
    "CorrectionError",
    "Entry",
    "Slot",
    "VespersData",
    "apply",
    "apply_vespers",
    "batch_summary",
    "coerce",
    "correct",
    "correct_batch",
    "drop",
    "kind_of",
    "load",
    "load_base",
    "load_vespers",
    "no_ops",
    "problems",
    "save",
    "slot",
    "stale_outputs",
    "write",
    "write_all",
]
