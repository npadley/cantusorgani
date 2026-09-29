"""Hand corrections, applied over the generated catalogue (data/corrections.yml).

`noh catalog` reads the scans and writes data/catalog.base.json; this module
applies data/corrections.yml over it and writes data/catalog.json, which the
site reads. Applying needs no PDFs, so an editor without pdf-source/ -- and CI --
can land a correction.

Each entry records `was`, the generated value when the fix was made. If a later
catalogue run changes that value, the entry is stale and the build stops rather
than silently overwrite a value nobody has looked at.

Fix at the source when the source can express it (data/index-*.yml,
data/vespers/vespers-offices.yml). This overlay is for what the pipeline computes.
"""

from __future__ import annotations

import copy
import itertools
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import yaml

from pipeline import sections
from pipeline.volumes import DATA

CORRECTIONS = DATA / "corrections.yml"
BASE = DATA / "catalog.base.json"
CATALOG = DATA / "catalog.json"
#: The pipeline's review queue; a `review:` target names one of its items by key.
REVIEW_QUEUE = DATA / "review-queue.json"
#: The reviews that still hold, for the admin screen (what is confirmed drops off its queues).
REVIEWED = DATA / "reviewed.json"
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
_REVIEWS: dict[str, Any] = _SCHEMA["reviews"]
#: A typeset:<file> target's file (a path under data/typeset/src/).
TYPESET_FILE = re.compile(_SCHEMA["typeset_file"]["pattern"])
#: The field that says which part a typeset file is.
MATCH_FIELD = "match"
#: The field that records a review. It changes no data, and a review whose
#: confirmed value has changed lapses (the item comes back) rather than
#: stopping the build.
REVIEW_FIELD: str = _REVIEWS["field"]
REVIEW_KINDS: frozenset[str] = frozenset(_REVIEWS["kinds"])
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
#   piece:<slug>                          title, incipit, mode, genre, printed_pages, system_range
#   part:<slug>/<part>[:<variant>]        start_system (counting from 1), chant
#   vespers:<office>/antiphon-<n>         tone, chant, refs, note   (an office of vespers/vespers-offices.yml)
#   vespers:<office>/magnificat           tone, chant, refs, note
#   vespers:sunday:<key>/magnificat       tone, chant, refs, note   (vespers/vespers-noh8.yml magnificat_antiphons)
#   pairing:<slug>/<movement>             chant   (a Kyrie, Gloria... of a piece without Proper parts)
#   review:<volume>/<kind>/<id>           reviewed   (an item of review-queue.json, by its key)
#   typeset:<file>                        match, reviewed   (a transcription in data/typeset/src/)
# `reviewed: yes` (on a part, a review item or a typeset file) records that an
# editor found it right; `was` is what they confirmed (for a typeset file, its
# render hash), and when that changes the review lapses. A typeset file's match
# is the part it is (part:..., movement:<slug>/<movement>, piece:<slug>), none
# (not in the catalogue) or other-setting; it is applied over
# data/typeset/parts.yml when the manifest is written.
# A chant is a GregoBase id, or none; refs are the systems it is printed on
# ("noh8/0077/000 noh8/0077/001"); a note is shown in place of the music (none
# shows the music again). A system_range is a piece's first and last system
# ("noh1/0044/002-noh1/0046/003"): systems it takes from the piece before or
# after leave that piece, and every other correction counts from the new range.
# For example:
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
    if kind not in _SPECS and kind not in REVIEW_KINDS:
        raise CorrectionError(f"{target} is not a target this file can correct; targets are "
                              f"{'; '.join(_SCHEMA['targets_help'].values())}")
    return kind


def coerce(name: str, value: object, genre: str | None = None, kind: str = "piece") -> Any:
    """A value as the data stores it; raises CorrectionError naming the rule.

    `genre` is the piece's, where known: some fields do not apply to some genres
    (a Proper has no single mode)."""
    if name == REVIEW_FIELD:
        text = "yes" if value is True else str(value).strip().lower()
        if kind not in REVIEW_KINDS:
            raise CorrectionError(f"a {kind} cannot be marked {REVIEW_FIELD}; only a "
                                  f"{' or '.join(sorted(REVIEW_KINDS))} can")
        if not re.fullmatch(_REVIEWS["pattern"], text):
            raise CorrectionError(f"{REVIEW_FIELD} is {_REVIEWS['hint']}, not {text!r}")
        return text
    spec = _SPECS.get(kind, {})
    if name not in spec:
        raise CorrectionError(f"unknown field {name!r}; the correctable fields of a {kind} are {', '.join(spec)}")
    rule = spec[name]
    if genre is not None and genre in (rule.get("not_for_genres") or {}):
        raise CorrectionError(str(rule["not_for_genres"][genre]))
    if name == "printed_pages" and isinstance(value, list) and len(value) == 2:
        value = f"{value[0]}-{value[1]}"
    if name == "refs" and isinstance(value, list):
        value = " ".join(str(v) for v in value)
    if name == "system_range":
        value = "-".join(str(v) for v in value) if isinstance(value, list) else re.sub(
            r"\s*(?:\bto\b|-|\s)\s*", "-", str(value).strip())
    text = "none" if value is None and name in ("chant", "note") else " ".join(str(value).split())
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
    if name == "refs":
        return text.split()
    if name == "system_range":
        first, last = text.split("-")
        if first.split("/")[0] != last.split("/")[0]:
            raise CorrectionError(f"system range {text!r} runs across two volumes")
        if first > last:
            raise CorrectionError(f"system range {text!r} runs backwards")
        return [first, last]
    if name == "note":
        return None if text == "none" else text
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
    """The reviewed Vespers files, as loaded: the overlay's vespers targets.
    `known` is every system in the catalogue, for checking corrected refs (empty:
    not checked here; load_reviewed checks every ref after the overlay)."""
    doc: dict[str, Any]
    offices: dict[str, Any]
    known: frozenset[str] = frozenset()


def load_vespers(data: Path = DATA) -> VespersData:
    doc = yaml.safe_load((data / "vespers" / "vespers-noh8.yml").read_text(encoding="utf-8")) or {}
    offices_path = data / "vespers" / "vespers-offices.yml"
    offices = (yaml.safe_load(offices_path.read_text(encoding="utf-8")) or {}).get("offices", {}) \
        if offices_path.exists() else {}
    base = data / "catalog.base.json"
    known = frozenset(r for p in json.loads(base.read_text(encoding="utf-8"))["pieces"] for r in p["systems"]) \
        if base.exists() else frozenset()
    return VespersData(doc, offices, known)


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
    found = next((s for s in sections.of(piece) if sections.named(s, part, variant)), None) if piece else None
    if piece is None or found is None:
        raise _gone(target)
    systems: list[str] = piece.get("systems") or []
    if name == "chant":
        return Slot(get=lambda: found.get("gregobase_id"), put=lambda v: found.__setitem__("gregobase_id", v))
    if "system" not in found:
        raise CorrectionError(f"{target} is printed in another volume ({found.get('borrowed_from', 'elsewhere')}); "
                              "correct it where it is printed")

    def check(n: Any) -> str | None:
        # Order against the other parts is checked on the result (_part_order),
        # so two parts can be moved past each other in either order.
        if not 1 <= int(n) <= len(systems):
            return f"{target} start_system {n} is outside the piece, which has {len(systems)} systems"
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

    def check(refs: Any) -> str | None:
        missing = [r for r in refs if data.known and r not in data.known]
        return f"{target} refs {', '.join(missing)} are not systems in the catalogue" if missing else None

    def put(v: Any) -> None:
        if v is None and name == "note":
            entry.pop("note", None)
        else:
            entry[name] = v

    return Slot(get=lambda: entry.get(name), put=put, check=check if name == "refs" else None)


_VOLUME_SYSTEMS: dict[str, list[tuple[str, str, list[int]]]] = {}


def volume_systems(vol: str) -> list[tuple[str, str, list[int]]]:
    """Every published system of a volume's body in book order, as (ref, asset
    key, [width, height]): from data/published/<vol>.json, so no PDFs are needed."""
    if vol not in _VOLUME_SYSTEMS:
        from pipeline.offset import load_page_map
        from pipeline.publish import _published, asset_stem
        page_map = load_page_map(vol)
        out = []
        for page, systems in sorted(_published(vol).items()):
            pdf = int(page)
            if page_map.to_printed(pdf) is None:
                continue
            for s in sorted(systems, key=lambda s: int(s["index"])):
                index = int(s["index"])
                out.append((f"{vol}/{pdf:04d}/{index:03d}", asset_stem(vol, pdf, index, str(s["sha256"])),
                            [int(s["width"]), int(s["height"])]))
        _VOLUME_SYSTEMS[vol] = out
    return _VOLUME_SYSTEMS[vol]


def _set_systems(piece: dict[str, Any], span: list[tuple[str, str, list[int]]]) -> None:
    """Give a piece these systems, keeping what hangs on them: its parts' starts
    are re-counted, movements and hymns off the new range are let go, and its
    pages follow its systems."""
    from pipeline.offset import load_page_map
    refs = [r for r, _, _ in span]
    piece.update(systems=refs, system_assets=[a for _, a, _ in span], system_aspect=[list(x) for _, _, x in span])
    for part in sections.printed(piece):
        part["system"] = refs.index(part["ref"])
    inside = set(refs)
    piece["movements"] = [m for m in piece.get("movements") or [] if m.get("ref") in inside]
    if "hymns" in piece:
        piece["hymns"] = [h for h in piece["hymns"] if h.get("ref") in inside]
    pdfs = [int(r.split("/")[1]) for r in refs]
    page_map = load_page_map(str(piece["volume"]))
    printed = [n for n in (page_map.to_printed(p) for p in pdfs) if n is not None]
    piece["pdf_pages"] = [min(pdfs), max(pdfs)]
    if printed:
        piece["printed_pages"] = [min(printed), max(printed)]


def _range_slot(target: str, piece: dict[str, Any], pieces: dict[str, dict[str, Any]]) -> Slot:
    """A piece's first and last system. Moving a boundary moves it for the
    neighbour too: systems the new range takes leave the piece that had them."""
    vol = str(piece["volume"])
    neighbours = [p for p in pieces.values() if p.get("volume") == vol and p is not piece]

    def span(v: list[str]) -> list[tuple[str, str, list[int]]]:
        order = volume_systems(vol)
        refs = [r for r, _, _ in order]
        return order[refs.index(v[0]):refs.index(v[1]) + 1]

    def check(v: list[str]) -> str | None:
        known = {r for r, _, _ in volume_systems(vol)}
        wrong = [r for r in v if r not in known]
        if wrong:
            return f"{target} system_range: {', '.join(wrong)} is not a system of {vol}'s pages"
        from pipeline.offset import load_page_map
        page_map = load_page_map(vol)
        own = piece.get("pagination")
        for r, _, _ in span(v):
            seg = page_map.segment_of(int(r.split("/")[1]))
            if seg is not None and seg.pagination != own:
                where = f"addendum {seg.pagination}" if seg.pagination else "the body of the volume"
                return f"{target} system_range: {r} is in {where}, which has its own pages"
        new = {r for r, _, _ in span(v)}
        for part in sections.printed(piece):
            if part["ref"] not in new:
                return (f"{target} system_range would leave its {part['kind']} (which starts on {part['ref']}) "
                        f"outside the piece; correct that part's start_system first")
        for other in neighbours:
            theirs = other.get("systems") or []
            lost = [i for i, r in enumerate(theirs) if r in new]
            if not lost:
                continue
            if len(lost) == len(theirs):
                return f"{target} system_range would take every system of piece:{other['slug']}"
            if lost[0] != 0 and lost[-1] != len(theirs) - 1 or len(lost) != lost[-1] - lost[0] + 1:
                return f"{target} system_range would split piece:{other['slug']} in two"
            for part in sections.printed(other):
                if part["ref"] in new:
                    return (f"{target} system_range would take the system piece:{other['slug']}'s "
                            f"{part['kind']} starts on ({part['ref']}); correct that part first")
        return None

    def put(v: list[str]) -> None:
        taken = span(v)
        new = {r for r, _, _ in taken}
        gained = [h for o in neighbours for h in o.get("hymns") or [] if h.get("ref") in new]
        for other in neighbours:
            theirs = other.get("systems") or []
            if any(r in new for r in theirs):
                keep = [(r, a, list(x)) for r, a, x in zip(theirs, other.get("system_assets") or [],
                                                            other.get("system_aspect") or [], strict=False)
                        if r not in new]
                _set_systems(other, keep)
        _set_systems(piece, taken)
        if gained:
            piece.setdefault("hymns", []).extend(gained)

    def get() -> list[str] | None:
        systems = piece.get("systems") or []
        return [systems[0], systems[-1]] if systems else None

    return Slot(get=get, put=put, check=check, genre=str(piece.get("genre")))


_CHANTS: dict[str, Any] | None = None


def _chant_names() -> dict[str, Any]:
    """data/chants.json's entries, for a new pairing's incipit and mode."""
    global _CHANTS
    if _CHANTS is None:
        path = DATA / "chants.json"
        _CHANTS = json.loads(path.read_text(encoding="utf-8")).get("chants", {}) if path.exists() else {}
    return _CHANTS


def piece_movements(piece: dict[str, Any]) -> list[str]:
    """The chant movements a piece has: its genre's, and for an Ordinary only
    those printed in it (found in its pages, or already paired) -- Missa XVII,
    for the Sundays of Advent and Lent, has no Gloria."""
    allowed = _SCHEMA["pairing_movements"].get(str(piece.get("genre")), [])
    if str(piece.get("genre")) != "mass_ordinary":
        return list(allowed)
    present = {m.get("movement") for m in piece.get("movements") or []} | \
              {c.get("movement") for c in piece.get("chant") or []}
    return [m for m in allowed if m in present]


def _pairing_slot(target: str, pieces: dict[str, dict[str, Any]]) -> Slot:
    """The chant paired with one movement of a piece without Proper parts:
    setting it adds or replaces the pairing (verified: a person chose it),
    none removes it."""
    m = re.fullmatch(r"pairing:([a-z0-9-]+)/([a-z]+)", target)
    if not m:
        raise CorrectionError(f"{target} is not of the form pairing:<slug>/<movement>")
    piece = pieces.get(m.group(1))
    if piece is None:
        raise _gone(target)
    movements = piece_movements(piece)
    if m.group(2) not in movements:
        raise CorrectionError(f"{target}: a {piece.get('genre')} has no {m.group(2)} chant to pair"
                              + (f" (its movements: {', '.join(movements)})" if movements else
                                 "; a Proper's chants are on its parts (part:<slug>/<part>)"))
    movement = None if m.group(2) == "chant" else m.group(2)
    pairings: list[dict[str, Any]] = piece.setdefault("chant", [])

    def found() -> dict[str, Any] | None:
        return next((c for c in pairings if c.get("movement") == movement), None)

    def put(v: Any) -> None:
        pairings[:] = [c for c in pairings if c.get("movement") != movement]
        if v is not None:
            named = _chant_names().get(str(v), {})
            pairings.append({"source": "gregobase", "id": int(v), "movement": movement,
                             "incipit": named.get("incipit") or f"GregoBase {v}", "mode": named.get("mode"),
                             "score": 1.0, "status": "verified"})

    return Slot(get=lambda: (found() or {}).get("id"), put=put, genre=str(piece.get("genre")))


_QUEUE: dict[tuple[str, int], dict[str, str]] = {}


def review_fingerprints(path: Path | None = None) -> dict[str, str]:
    """Each review-queue item's fingerprint, by key (pipeline/reviewkeys.py)."""
    path = path or REVIEW_QUEUE
    if not path.exists():
        return {}
    cache = (str(path), path.stat().st_mtime_ns)
    if cache not in _QUEUE:
        items = json.loads(path.read_text(encoding="utf-8"))
        _QUEUE[cache] = {str(i["key"]): str(i["fingerprint"]) for i in items if "key" in i}
    return _QUEUE[cache]


def part_fingerprint(piece: dict[str, Any], part: dict[str, Any]) -> str:
    """What a review of a part confirms: where it starts and how long it runs (a
    part runs until the next printed part starts). The admin screen's "Parts to
    check" says the same (web/src/lib/admin/suspects.ts partFingerprint)."""
    placed = sections.printed(piece)
    at = next(i for i, p in enumerate(placed) if p is part)
    end = placed[at + 1]["system"] if at + 1 < len(placed) else len(piece.get("systems") or [])
    return f"start {part['system'] + 1}, {end - part['system']} systems"


def _review_slot(target: str, kind: str, catalog: dict[str, Any] | None) -> Slot:
    """What a review of this target confirms. Reviews change no data: put does nothing."""
    def keep(_: Any) -> None:
        return None

    if kind == "typeset":
        from pipeline.typeset import match
        from pipeline.typeset.render import source_hash
        path = match.SRC / _typeset_file(target)
        if not path.exists():
            raise CorrectionError(f"{target} is not a transcription in data/typeset/src/")
        return Slot(get=lambda: source_hash(path.read_text(encoding="utf-8")), put=keep)
    if kind == "review":
        from pipeline.reviewkeys import KEY
        if not KEY.fullmatch(target):
            raise CorrectionError(f"{target} is not of the form review:<volume>/<kind>/<id>")
        found = review_fingerprints().get(target)
        if found is None:
            raise CorrectionError(f"{target} is no longer in the review queue")
        return Slot(get=lambda: found, put=keep)
    m = re.fullmatch(r"part:([a-z0-9-]+)/([a-z]+)(?::([a-z0-9-]+))?", target)
    if not m:
        raise CorrectionError(f"{target} is not of the form part:<slug>/<part>[:<variant>]")
    piece = _pieces(catalog or {}).get(m.group(1))
    part = next((s for s in sections.of(piece or {}) if sections.named(s, m.group(2), m.group(3) or "")), None)
    if piece is None or part is None:
        raise _gone(target)
    if "system" not in part:
        raise CorrectionError(f"{target} is printed in another volume; review it where it is printed")
    return Slot(get=lambda: part_fingerprint(piece, part), put=keep)


def _typeset_file(target: str) -> str:
    file = target.split(":", 1)[1] if ":" in target else ""
    if not TYPESET_FILE.fullmatch(file):
        raise CorrectionError(f"{target} is not of the form typeset:<file>, a path under data/typeset/src/ "
                              "such as typeset:vol-1/al_crastina_die.csv.ly")
    return file


_PARTS_CACHE: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}


def _typeset_entries() -> dict[str, dict[str, Any]]:
    """data/typeset/parts.yml's entries, by file (as the matcher left them)."""
    from pipeline.typeset import match
    path = match.PARTS_FILE
    if not path.exists():
        return {}
    cache = (str(path), path.stat().st_mtime_ns)
    if cache not in _PARTS_CACHE:
        _PARTS_CACHE[cache] = {str(e["file"]): e for e in match.load(path)}
    return _PARTS_CACHE[cache]


def _typeset_slot(target: str, catalog: dict[str, Any] | None) -> Slot:
    """Which part a transcription is. Reads and writes nothing here: the
    manifest applies it over parts.yml (pipeline/typeset/match.py with_choices).
    What it was is what the matcher settled on (a target only when matched)."""
    from pipeline.typeset.match import settled, targets
    entry = _typeset_entries().get(_typeset_file(target))
    if entry is None:
        raise CorrectionError(f"{target} is not a transcription in data/typeset/src/ (parts.yml has no entry for it)")

    def check(value: Any) -> str | None:
        if ":" not in str(value):
            return None
        if entry.get("status") == "broken":
            why = (entry.get("evidence") or {}).get("error") or "it does not compile"
            return (f"{target} cannot be shown as {value}: LilyPond cannot draw it ({str(why)[:120]}); "
                    "fix the file first, or choose none or other-setting")
        if catalog is not None and value not in {t.target for t in targets(catalog, lambda ref: None)}:
            return f"{target} match: {value} is not a part, movement or piece the catalogue has"
        return None

    return Slot(get=lambda: settled(entry), put=lambda _: None, check=check)


def typeset_choices(entries: list[Entry]) -> dict[str, str]:
    """The editors' answers to which part each typeset file is, by file."""
    return {e.target.split(":", 1)[1]: str(e.value) for e in entries
            if e.field == MATCH_FIELD and e.target.startswith("typeset:")}


def slot(target: str, name: str, catalog: dict[str, Any] | None, vespers: VespersData | None) -> Slot:
    """The slot a target's field names; raises CorrectionError saying why not."""
    kind = kind_of(target)
    if name == REVIEW_FIELD:
        if kind not in REVIEW_KINDS:
            raise CorrectionError(f"a {kind} cannot be marked {REVIEW_FIELD}; only a "
                                  f"{' or '.join(sorted(REVIEW_KINDS))} can")
        return _review_slot(target, kind, catalog)
    if kind not in _SPECS:
        raise CorrectionError(f"{target}: a {kind} target takes only {REVIEW_FIELD}")
    if name not in _SPECS[kind]:
        raise CorrectionError(f"unknown field {name!r}; the correctable fields of a {kind} are "
                              f"{', '.join(_SPECS[kind])}")
    if kind == "vespers":
        if vespers is None:
            raise CorrectionError(f"{target}: the Vespers files are not loaded")
        return _vespers_slot(target, name, vespers)
    if kind == "typeset":
        return _typeset_slot(target, catalog)
    pieces = _pieces(catalog or {})
    if kind == "part":
        return _part_slot(target, name, pieces)
    if kind == "pairing":
        return _pairing_slot(target, pieces)
    piece = _piece(target, pieces)
    if piece is None:
        raise _gone(target)
    if name == "system_range":
        return _range_slot(target, piece, pieces)
    return Slot(get=lambda: piece.get(name), put=lambda v: piece.__setitem__(name, v), genre=str(piece.get("genre")))


def _is_range(e: Entry) -> bool:
    return e.field == "system_range" and e.target.startswith("piece:")


def _stale(e: Entry, now: Any) -> str:
    return (f"{_where(e)}: stale correction: {e.target} {e.field} was {e.was!r} when the fix "
            f"was made but the data now says {now!r}; check the new value, "
            "then set `was` to it or delete this entry (`uv run noh corrections --drop "
            f"{e.id}`)")


def _ranged(base: dict[str, Any], entries: list[Entry]) -> tuple[dict[str, Any], dict[str, str]]:
    """The catalogue with every system_range entry applied in file order, each
    checked against the catalogue as it stands just before it; and each failing
    entry's problem, by id. Every other correction counts from this layer: a
    part's start is a system of the piece as corrected."""
    catalog = copy.deepcopy(base)
    failed: dict[str, str] = {}
    for e in entries:
        if not _is_range(e):
            continue
        try:
            s = slot(e.target, e.field, catalog, None)
            value = coerce(e.field, e.value, s.genre)
        except CorrectionError as exc:
            failed[e.id] = f"{_where(e)}: {exc}" if str(exc).startswith(e.target) else f"{_where(e)}: {e.target} {exc}"
            continue
        if s.get() != e.was:
            failed[e.id] = _stale(e, s.get())
            continue
        issue = s.check(value) if s.check else None
        if issue:
            failed[e.id] = f"{_where(e)}: {issue}"
            continue
        s.put(value)
    return catalog, failed


_PART_NAMES = {"introit": "Introit", "gradual": "Gradual", "alleluia": "Alleluia", "tract": "Tract",
               "sequence": "Sequence", "hymn": "Hymn", "offertory": "Offertory", "communion": "Communion",
               "other": "Section"}


def _part_order(layer: dict[str, Any], entries: list[Entry], skip: set[str]) -> list[str]:
    """Each piece's printed parts must start in the order they are printed once
    every start_system entry is applied. Checked on the result, not entry by
    entry: moving the Gradual down past where the Alleluia starts now is right
    when the Alleluia moves down too. A part runs until the next one starts."""
    catalog = copy.deepcopy(layer)
    moved: dict[str, list[Entry]] = {}
    for e in entries:
        if e.field != "start_system" or kind_of(e.target) != "part" or e.id in skip:
            continue
        try:
            s = slot(e.target, e.field, catalog, None)
            s.put(coerce(e.field, e.value, s.genre, "part"))
        except CorrectionError:
            continue
        moved.setdefault(e.target.split(":", 1)[1].split("/")[0], []).append(e)
    pieces = _pieces(catalog)
    out = []
    for slug, mine in moved.items():
        placed = sections.printed(pieces[slug])
        # The Paschal Alleluia stands in for the Gradual and Alleluia, so a book
        # may print it before them (NOH3's Queenship addendum) or after: it only
        # may not start where another part does.
        paschal = [p for p in placed if p.get("variant") == "paschal"]
        placed = [p for p in placed if p.get("variant") != "paschal"]
        clash = next(((p, q) for p in paschal for q in placed if p["system"] == q["system"]), None)
        if clash:
            placed = [clash[1], clash[0]]
        for a, b in itertools.pairwise(placed):
            if a["system"] < b["system"]:
                continue
            names = [f"{_PART_NAMES.get(x['kind'], x['kind'])}{sections.suffix(x).replace(':', ' ')}"
                     for x in (a, b)]
            which = {sections.target(slug, x): n for x, n in zip((a, b), names, strict=True)}
            e = next((m for m in reversed(mine) if m.target in which), mine[-1])
            other = next((n for t, n in which.items() if t != e.target), names[1])
            out.append(f"{_where(e)}: {e.target} start_system out of order: the {names[0]} would start on "
                       f"system {a['system'] + 1} and the {names[1]} on system {b['system'] + 1}, but a part "
                       f"runs until the next one starts; move the {other} too, or choose another system")
            break
    return out


def _check(base: dict[str, Any] | None, entries: list[Entry], vespers: VespersData | None = None,
           order: bool = True) -> tuple[list[str], dict[str, Any] | None]:
    """(problems, the catalogue with system ranges applied). `order`: also check
    that parts start in printed order once every entry is applied."""
    layer, failed = _ranged(base, entries) if base is not None else (None, {})
    genres = {str(p.get("genre")) for p in _pieces(base or {}).values()}
    seen: dict[tuple[str, str], str] = {}
    ids: set[str] = set()
    out: list[str] = []
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
        if e.field == REVIEW_FIELD:
            # Only its form: a review whose target has changed or gone lapses.
            try:
                coerce(e.field, e.value, None, kind)
            except CorrectionError as exc:
                out.append(f"{where}: {e.target} {exc}")
            continue
        if _is_range(e):
            if e.id in failed:
                out.append(failed[e.id])
            continue
        try:
            s = slot(e.target, e.field, layer, vespers)
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
            out.append(_stale(e, s.get()))
            continue
        issue = s.check(value) if s.check else None
        if issue:
            out.append(f"{where}: {issue}")
    chosen: dict[str, Entry] = {}
    for e in entries:
        if e.field == MATCH_FIELD and e.target.startswith("typeset:") and ":" in str(e.value):
            first = chosen.setdefault(str(e.value), e)
            if first is not e:
                out.append(f"{_where(e)}: {e.target} and {first.target} ({first.id}) are both chosen as "
                           f"{e.value}; a part shows one transcription, so keep one")
    if order and layer is not None:
        bad = {e.id for e in entries if any(m.startswith(f"{_where(e)}:") for m in out)}
        out += _part_order(layer, entries, bad)
    return out, layer


def problems(base: dict[str, Any] | None, entries: list[Entry], vespers: VespersData | None = None,
             order: bool = True) -> list[str]:
    """Every reason the entries cannot be applied, one line each. Entries of a
    kind whose data is not given (vespers without `vespers`, pieces and parts
    without `base`) are left to the call that has it. `order=False` leaves out
    the order of parts, which only the finished file can settle."""
    return _check(base, entries, vespers, order)[0]


def apply(base: dict[str, Any], entries: list[Entry]) -> dict[str, Any]:
    """A new catalogue with every piece and part entry applied; raises if any
    cannot be. System ranges go first (see _ranged); Vespers entries are
    applied when the Vespers files load."""
    found, layer = _check(base, entries)
    if found:
        raise CorrectionError("\n".join(found))
    catalog = layer if layer is not None else copy.deepcopy(base)
    for e in entries:
        if kind_of(e.target) != "vespers" and not _is_range(e) and e.field != REVIEW_FIELD:
            s = slot(e.target, e.field, catalog, None)
            s.put(coerce(e.field, e.value, s.genre, kind_of(e.target)))
    return catalog


def apply_vespers(data: VespersData, entries: list[Entry]) -> VespersData:
    """The Vespers files with every vespers entry applied; raises if any cannot be."""
    found = problems(None, entries, data)
    if found:
        raise CorrectionError("\n".join(found))
    out = VespersData(copy.deepcopy(data.doc), copy.deepcopy(data.offices), data.known)
    for e in entries:
        if kind_of(e.target) == "vespers":
            slot(e.target, e.field, None, out).put(coerce(e.field, e.value, None, "vespers"))
    return out


def no_ops(base: dict[str, Any], entries: list[Entry], vespers: VespersData | None = None) -> list[Entry]:
    """Entries whose value the generated data now has anyway: fixed at the
    source, so they can be deleted."""
    layer = _ranged(base, entries)[0]
    out = []
    for e in entries:
        if e.field == REVIEW_FIELD:
            continue
        try:
            kind = kind_of(e.target)
            if kind == "vespers" and vespers is None:
                continue
            s = slot(e.target, e.field, base if _is_range(e) else layer, vespers)
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
             "by": "reader" if e.source.startswith("reader") else "editor"} for e in reversed(entries)
            if e.field != REVIEW_FIELD]
    return json.dumps({"schema_version": 1, "corrections": rows}, indent=2, ensure_ascii=False) + "\n"


def reviews(catalog: dict[str, Any], entries: list[Entry]) -> tuple[list[Entry], list[Entry]]:
    """(current, lapsed): the reviews whose confirmed value still holds against
    the corrected catalogue and the review queue, and those that no longer do."""
    current: list[Entry] = []
    lapsed: list[Entry] = []
    for e in entries:
        if e.field != REVIEW_FIELD:
            continue
        try:
            now = _review_slot(e.target, kind_of(e.target), catalog).get()
        except CorrectionError:
            now = None
        (current if now is not None and now == e.was else lapsed).append(e)
    return current, lapsed


def reviewed_text(current: list[Entry]) -> str:
    """data/reviewed.json: what still stands reviewed, and what was confirmed."""
    rows = {e.target: {"was": e.was, "date": e.date} for e in sorted(current, key=lambda e: e.target)}
    return json.dumps({"schema_version": 1, "reviewed": rows}, indent=2, ensure_ascii=False) + "\n"


def _outputs(base_path: Path, path: Path, out: Path) -> dict[Path, str]:
    """Every file the corrections produce, with its text."""
    from pipeline.vespers import LINEUP, lineup_anchor, lineup_text
    entries = load(path)
    catalog = apply(load_base(base_path), entries)
    lineup = lineup_text(today=lineup_anchor())
    stranded = _stranded(catalog, json.loads(lineup))
    if stranded:
        raise CorrectionError(f"a system_range correction leaves {stranded[0]}"
                              + (f" (and {len(stranded) - 1} more)" if len(stranded) > 1 else "")
                              + " in no piece, but a Vespers page shows it; widen that piece's range, "
                                "or give the system to the piece before or after")
    from pipeline.typeset.manifest import MANIFEST, REVIEW, build, text
    manifest, review_list = build(corrections=entries)
    return {out: dump(catalog), LINEUP: lineup, LOG: log_text(entries),
            REVIEWED: reviewed_text(reviews(catalog, entries)[0]),
            MANIFEST: text(manifest), REVIEW: text(review_list)}


def _stranded(catalog: dict[str, Any], lineup: dict[str, Any]) -> list[str]:
    """Systems the Vespers lineup shows that no piece of the corrected catalogue
    has (the site finds each Vespers image through the piece that owns it)."""
    known = {r for p in catalog.get("pieces", []) for r in p.get("systems") or []}
    days = [*lineup.get("days", {}).values(), *lineup.get("first_vespers", {}).values()]
    return sorted({r for d in days for i in d["items"] if i["source"]["type"] != "note"
                   for r in i["source"].get("refs") or []} - known)


def write_all(base_path: Path = BASE, path: Path = CORRECTIONS, out: Path = CATALOG) -> tuple[int, list[str]]:
    """Apply every correction: catalog.json, the Vespers lineup (rebuilt for the
    window it already covers), the public log, reviewed.json and the typeset
    manifest and review list. Returns (entries, files changed)."""
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


def review(target: str, value: str = "yes", note: str = "", source: str = "editor", editor_email: str = "",
           seen: str | None = None, today: date | None = None, base_path: Path = BASE,
           path: Path = CORRECTIONS) -> tuple[Entry, bool]:
    """Record that an editor found a target right; returns (entry, replaced an
    earlier one). `was` is what they confirmed, taken from the catalogue as the
    site shows it (every correction applied). `seen`, when given, is what the
    editor was shown: if it is not what is there now, the review is refused, so
    nobody confirms a value they never saw."""
    kind = kind_of(target)
    text = coerce(REVIEW_FIELD, value, None, kind)
    entries = load(path)
    catalog = apply(load_base(base_path), entries) if kind == "part" else None
    now = _review_slot(target, kind, catalog).get()
    if seen is not None and seen != now:
        raise CorrectionError(f"{target} has changed since it was shown for review (it said {seen!r}, "
                              f"now {now!r}); look at it again")
    stamp = (today or datetime.now(UTC).date()).isoformat()
    for e in entries:
        if (e.target, e.field) == (target, REVIEW_FIELD):
            if e.was != now:
                e.was, e.value, e.note, e.source, e.date = now, text, note or e.note, source, stamp
                e.editor_email = editor_email or e.editor_email
                save(entries, path)
            return e, True
    entry = Entry(id=next_id(entries), target=target, field=REVIEW_FIELD, was=now, value=text,
                  source=source, date=stamp, note=note, editor_email=editor_email)
    save([*entries, entry], path)
    return entry, False


def correct(target: str, name: str, value: str, note: str = "", source: str = "editor",
            editor_email: str = "", today: date | None = None, base_path: Path = BASE,
            path: Path = CORRECTIONS, vespers_dir: Path = DATA, order: bool = True) -> tuple[Entry, bool]:
    """Record one correction; returns (entry, replaced an earlier one).
    `order=False` defers the order of parts to the caller (a batch checks it
    once every entry is in)."""
    if name == REVIEW_FIELD:
        return review(target, value, note, source, editor_email, today=today, base_path=base_path, path=path)
    kind = kind_of(target)
    base = load_base(base_path) if kind != "vespers" else None
    vespers = load_vespers(vespers_dir) if kind == "vespers" else None
    entries = load(path)
    # What the site shows: the catalogue with the system ranges already corrected.
    layer = _ranged(base, entries)[0] if base is not None else None
    try:
        s = slot(target, name, layer, vespers)
    except CorrectionError as exc:
        raise CorrectionError(f"{exc}. Run `uv run noh where <page URL>` to find the target") from None
    new = coerce(name, value, s.genre, kind)
    if new == s.get():
        raise CorrectionError(f"{target} {name} is already {new!r}; nothing to correct")
    issue = s.check(new) if s.check else None
    if issue:
        raise CorrectionError(issue)
    stamp = (today or datetime.now(UTC).date()).isoformat()
    for e in entries:
        if (e.target, e.field) == (target, name):
            e.value, e.note, e.source, e.date = new, note or e.note, source, stamp
            e.editor_email = editor_email or e.editor_email
            _check_and_save(base, entries, path, vespers, order)
            return e, True
    entry = Entry(id=next_id(entries), target=target, field=name, was=s.get(), value=new,
                  source=source, date=stamp, note=note, editor_email=editor_email)
    _check_and_save(base, [*entries, entry], path, vespers, order)
    return entry, False


def _check_and_save(base: dict[str, Any] | None, entries: list[Entry], path: Path,
                    vespers: VespersData | None = None, order: bool = True) -> None:
    found = problems(base, entries, vespers, order)
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
        seen = item.get("seen")
        if seen is not None and not (isinstance(seen, str) and len(seen) <= 80):
            errors.append(f"entry {n}: seen must be text of at most 80 characters")
            continue
        try:
            if str(item.get("field", "")) == REVIEW_FIELD:
                entry, _ = review(str(item.get("target", "")), str(item.get("value", "")),
                                  note=str(item.get("note", ""))[:200], source=source, editor_email=email,
                                  seen=seen, today=today, base_path=base_path, path=path)
            else:
                entry, _ = correct(str(item.get("target", "")), str(item.get("field", "")), str(item.get("value", "")),
                                   note=str(item.get("note", ""))[:200], source=source, editor_email=email,
                                   today=today, base_path=base_path, path=path, order=False)
            done.append(entry)
        except CorrectionError as exc:
            errors.append(f"entry {n} ({item.get('target')} {item.get('field')}): {exc}")
    if not errors:
        # The order of parts, once the whole batch is in: its moves may pass each other.
        errors += problems(load_base(base_path), load(path))
    if errors:
        if before is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(before, encoding="utf-8")
        raise CorrectionError(f"batch {batch_id}: nothing was recorded.\n" + "\n".join(errors))
    return done


# A batch merges itself once the site's checks pass, unless it holds one of
# these: moving systems between pieces can carry music into the wrong piece,
# and a large batch is worth a look. Those wait for the owner.
STRUCTURAL_FIELDS = frozenset({"system_range"})
LARGE_BATCH = 25


def hold_reasons(entries: list[Entry]) -> list[str]:
    """Why a batch waits for the owner instead of merging itself; empty when
    it can merge as soon as its checks pass."""
    reasons: list[str] = []
    structural = [e for e in entries if e.field in STRUCTURAL_FIELDS]
    if structural:
        reasons.append(f"{len(structural)} correction(s) move systems between pieces "
                       f"({', '.join(e.target for e in structural[:5])}"
                       f"{', ...' if len(structural) > 5 else ''})")
    # Reviews change no data, so they do not make a batch large.
    changes = [e for e in entries if e.field != REVIEW_FIELD]
    if len(changes) >= LARGE_BATCH:
        reasons.append(f"it has {len(changes)} corrections ({LARGE_BATCH} or more)")
    return reasons


def batch_summary(batch_id: str, entries: list[Entry], hold: list[str] | None = None) -> str:
    """The pull request's description: one line per correction, for review."""
    lines = [f"Corrections from the admin screen, batch `{batch_id}`.", "",
             "| Id | Target | Field | Was | Now | By | Note |", "|---|---|---|---|---|---|---|"]
    for e in entries:
        cells = [e.id, e.target, e.field, json.dumps(e.was, ensure_ascii=False), json.dumps(e.value, ensure_ascii=False),
                 e.editor_email or e.source, e.note]
        lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    if hold:
        lines += ["", "**Waits for the owner** because " + "; and ".join(hold) + ".",
                  "Merging deploys the site. Closing without merging returns these to the admin queue."]
    else:
        lines += ["", ("Merges itself once the site's checks pass, which deploys the site. "
                       "If a check fails, the pull request is closed and these go back to the admin screen.")]
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
    "MATCH_FIELD",
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
    "hold_reasons",
    "kind_of",
    "load",
    "load_base",
    "load_vespers",
    "no_ops",
    "part_fingerprint",
    "problems",
    "review",
    "review_fingerprints",
    "reviewed_text",
    "reviews",
    "save",
    "slot",
    "stale_outputs",
    "typeset_choices",
    "write",
    "write_all",
]
