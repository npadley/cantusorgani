"""Which part of the catalogue each transcription is: data/typeset/parts.yml.

For each file the candidates come from what the file says about itself: its
volume, its page ("%Page reference: page i.109"), what kind of part its name
says it is (in_, gr_, al_, tr_, of_, co_, se_), and for the Kyriale its folder
(missa-ix/kyrie_IX.ly is Mass IX's Kyrie). Each candidate is then scored by
melody against the chant GregoBase has for it, and the best few by their words
too (pipeline/typeset/melody.py, which writes out what GregoBase abbreviates:
"ij.", "iij.", "Gloria Patri. E u o u a e"). The best one is kept, with the
evidence. Melody and words both agreeing is the strongest match: it is enough
even with no page or name to go by, and words that agree carry a melody that is
only close. The same notes under other words are a type-melody, never a match.

Statuses:
  matched         a name or page candidate whose melody agrees (and clearly
                  better than any other), or the one target the file's own
                  name names (below): rendered for the site
  proposed        no confident answer; the admin screen's Typeset matches queue
  melody-differs  the file points at a part whose melody disagrees
  broken          LilyPond cannot read the file; the Typeset errors queue
A file's name settles it without the melody (evidence.name says what agreed):
  - the Kyriale: missa-i/kyrie_I.ly is Mass I's Kyrie and kyrie_ad_libitum_III.ly
    the Kyrie ad libitum III, whatever GregoBase's chant looks like;
  - a Proper: in_adorate_deum is the Introit on its page titled "Adorate Deum".
    With no page to go by, the name must fit one part of that kind in the whole
    volume, and the melody must not disagree.
A person settles proposed and melody-differs entries in the admin screen: a
`match` correction on typeset:<file> in data/corrections.yml, applied over this
file by with_choices() (the manifest is built from the result). This command
never overrides an entry marked source: editor.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from pipeline import sections
from pipeline.typeset.events import Events
from pipeline.typeset.melody import agreement
from pipeline.volumes import DATA

PARTS_FILE = DATA / "typeset" / "parts.yml"
SRC = DATA / "typeset" / "src"
PART_KINDS = {"in": "introit", "gr": "gradual", "al": "alleluia", "tr": "tract", "se": "sequence",
              "of": "offertory", "co": "communion"}
MOVEMENTS = ("kyrie", "gloria", "credo", "sanctus", "agnus", "ite")
ROMAN = {r: n for n, r in enumerate(
    ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii"], 1)}
VOLUME = {"vol-1": "noh1", "vol-2": "noh2", "vol-3": "noh3", "vol-5": "noh5"}
PAGE_REF = re.compile(r"Page reference:\s*page\s+([ivxIVX]+)\.(\d+)")
#: A match needs this much of the file's melody in the chant, in order ...
MATCHED = 0.85
#: ... and this much more than the next candidate.
MARGIN = 0.15
#: Below this, the file's own candidate is said to differ.
DIFFERS = 0.6
#: The words agree: with them, a melody that does not differ is enough.
WORDS = 0.85
#: The words are another text: the same notes are then a type-melody (the
#: Graduals of mode II, the Alleluias of mode VIII), not this chant.
OTHER_WORDS = 0.5
#: Candidates whose words are compared (the best by melody).
SHORTLIST = 4


@dataclass(frozen=True)
class Target:
    """Something a transcription can be: a Proper part, a Mass movement, or a
    whole single-chant piece; where it starts, and its chant."""
    target: str
    volume: str
    slug: str
    kind: str
    page: int | None
    chant: int | None
    #: What the catalogue calls it: a section's opening words.
    title: str | None = None


@dataclass(frozen=True)
class Hints:
    volume: str
    page: int | None
    kind: str | None
    mass: int | None
    number: int | None
    #: The file name's first word ("ite", "benedicamus", "kyrie", "in").
    word: str = ""


def hints(rel: str, text: str) -> Hints:
    """What a file says about itself, from its path and its page reference."""
    parts = rel.split("/")
    volume = VOLUME.get(parts[0], parts[0])
    m = PAGE_REF.search(text)
    page = int(m.group(2)) if m else None
    name = parts[-1].split(".")[0].lower()
    prefix = name.split("_", 1)[0]
    kind = PART_KINDS.get(prefix) or next((mv for mv in MOVEMENTS if name.startswith(mv)), None)
    folder = parts[-2] if len(parts) > 2 else ""
    mass = ROMAN.get(folder.removeprefix("missa-")) if folder.startswith("missa-") else None
    tail = re.search(r"_([ivx]+)$", name)
    number = ROMAN.get(tail.group(1)) if tail else None
    return Hints(volume, page, kind, mass, number, prefix)


def targets(catalog: dict[str, Any], printed: Any) -> list[Target]:
    """Every target in the catalogue. `printed(ref)` gives the printed page a
    system is on."""
    out: list[Target] = []
    for p in catalog.get("pieces", []):
        slug, volume = str(p["slug"]), str(p["volume"])
        systems = p.get("systems") or []
        for part in sections.printed(p):
            out.append(Target(sections.target(slug, part), volume, slug,
                              str(part["kind"]), printed(part["ref"]), part.get("gregobase_id"),
                              part.get("title") or None))
        chants = {c.get("movement"): c.get("id") for c in p.get("chant") or []}
        if p.get("genre") == "mass_ordinary":
            # A section listed for the Mass (its second Kyrie, each dismissal)
            # speaks for the system it starts on: the page shows no movement there.
            listed = {part["ref"] for part in sections.printed(p) if part.get("placed") != "order"}
            seen: set[str] = set()
            for mv in p.get("movements") or []:
                name = str(mv["movement"])
                if name in seen or mv["ref"] in listed:
                    continue
                seen.add(name)
                out.append(Target(f"movement:{slug}/{name}", volume, slug, name, printed(mv["ref"]), chants.get(name)))
        elif not p.get("sections") and systems:
            kind = str(p.get("genre"))
            chant = next(iter(chants.values()), None)
            out.append(Target(f"piece:{slug}", volume, slug, kind, printed(systems[0]), chant))
    return out


#: What a Kyriale file, or a row listed for a Mass, can be named for.
MASS_WORDS = frozenset({*MOVEMENTS, "benedicamus"})


def by_first_word(word: str, found: list[Target]) -> list[Target]:
    """A Mass's listed rows a file named `word`_... can be: those whose key
    begins with the same word (benedicamus_IV is the row `benedicamus`, not
    `ite`, though they share a melody); failing any, those not named for
    another movement (ite_XVIIa may be `deo-gratias-i`, never `kyrie-b`)."""
    def first(t: Target) -> str:
        return t.target.rsplit(":", 1)[-1].split("-")[0] if t.target.startswith("part:") else t.kind
    same = [t for t in found if first(t) == word]
    return same or [t for t in found if first(t) not in MASS_WORDS]


def roman_slug(n: int) -> str:
    return next(r for r, v in ROMAN.items() if v == n)


def candidates(h: Hints, all_targets: list[Target]) -> tuple[list[Target], str]:
    """The targets a file may be, and what chose them."""
    in_volume = [t for t in all_targets if t.volume == h.volume]
    if h.mass is not None:
        slug = f"ordinarium-missae-{roman_slug(h.mass)}"
        named = [t for t in in_volume if h.kind and t.target == f"movement:{slug}/{h.kind}"]
        if named and numbered(h):
            return named, "folder"
        # ite_XVIIa, kyrie_XVIIa, benedicamus_II: the movement, or one of the
        # sections listed for that Mass (data/sections); an editor says which.
        own = by_first_word(h.word, named + [t for t in in_volume if t.slug == slug and t.target.startswith("part:")])
        if own:
            return own, "folder"
    if h.number is not None and h.kind in MOVEMENTS:
        r = roman_slug(h.number)
        named = [t for t in in_volume if t.kind == h.kind and re.search(rf"-{h.kind}(-dei)?-{r}$", t.slug)]
        if named:
            return named, "name"
    if h.page is not None:
        on_page = [t for t in in_volume if t.page == h.page and (h.kind is None or t.kind == h.kind)]
        if on_page:
            return on_page, "page"
        near = [t for t in in_volume if t.page is not None and abs(t.page - h.page) <= 1
                and (h.kind is None or t.kind == h.kind)]
        if near:
            return near, "page"
    if h.kind:
        return [t for t in in_volume if t.kind == h.kind], "kind"
    return [], "none"


def _words(text: str) -> tuple[str, ...]:
    """Latin words as file names spell them: no accents, ae for æ, i for j."""
    plain = unicodedata.normalize("NFKD", text.lower().replace("æ", "ae").replace("œ", "oe"))
    plain = "".join(c for c in plain if not unicodedata.combining(c)).replace("j", "i")
    return tuple(re.findall(r"[a-z]+", plain))


def file_name(rel: str) -> list[tuple[str, ...]]:
    """The opening words a Proper file is named for, after its kind prefix:
    in_ego_autem_in__speravi is "Ego autem in ... speravi", and
    gr_speciosus_v_eructavit "Speciosus", verse "Eructavit". A trailing number
    (co_regina_mundi_272) is not a word. A later verse or strophe
    (an_lumen_ad_revelationem.3, hy_gloria_laus.2) is not named for the part:
    only its first file is."""
    pieces = rel.split("/")[-1].lower().split(".")
    stem = pieces[0]
    if "_" not in stem or (len(pieces) > 1 and pieces[1].isdigit() and pieces[1] != "1"):
        return []
    body = re.sub(r"_\d+$", "", stem.split("_", 1)[1])
    return [w for w in (_words(seg) for seg in re.split(r"__|_v_", body)) if w]


def catalogue_name(text: str) -> list[tuple[str, ...]]:
    """A title or a GregoBase incipit ("Ego autem in... speravi", "Confessio (Intr.)")
    in the same shape."""
    return [w for w in (_words(seg) for seg in re.sub(r"\([^)]*\)", "", text).split("...")) if w]


def _fits(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    n = min(len(a), len(b))
    return n > 0 and a[:n] == b[:n]


def named(rel: str, target: Target, chants: dict[str, Any]) -> str | None:
    """The catalogue's name for this target, if the file is named for it: the
    opening words fit, and nothing after a "..." contradicts (Gaudeamus ...
    Annae is not Gaudeamus ... Agathae)."""
    ours = file_name(rel)
    if not ours:
        return None
    incipit = (chants.get(str(target.chant)) or {}).get("incipit") if target.chant is not None else None
    found = None
    for text in (target.title, incipit):
        theirs = catalogue_name(text) if text else []
        if not theirs or not _fits(ours[0], theirs[0]):
            continue
        if any(not _fits(a, b) for a, b in zip(ours[1:], theirs[1:], strict=False)):
            return None
        found = found or text
    return found


def numbered(h: Hints) -> bool:
    """A Kyriale file whose name is the whole answer: kyrie_I in missa-i,
    credo_V, kyrie_ad_libitum_III. Not ite_IIa or kyrie_XVIIa: the catalogue
    has one Ite and one Kyrie for the Mass, and the name does not say which."""
    return h.number is not None and h.kind in MOVEMENTS and h.mass in (None, h.number)


@dataclass
class Entry:
    file: str
    target: str | None
    status: str
    evidence: dict[str, Any] = field(default_factory=dict)
    source: str = "match"

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"file": self.file, "target": self.target, "status": self.status}
        if self.source != "match":
            out["source"] = self.source
        out["evidence"] = self.evidence
        return out


def decide(rel: str, text: str, events: Events, all_targets: list[Target], chants: dict[str, Any]) -> Entry:
    if not events.ok:
        return Entry(rel, None, "broken", {"error": events.error})
    h = hints(rel, text)
    found, by = candidates(h, all_targets)
    evidence: dict[str, Any] = {"by": by, "incipit": events.incipit}
    if h.page is not None:
        evidence["page"] = h.page
    def gabc_of(t: Target) -> str | None:
        return (chants.get(str(t.chant)) or {}).get("gabc") if t.chant is not None else None

    scored: list[tuple[Target, float | None]] = []
    for t in found:
        gabc = gabc_of(t)
        scored.append((t, agreement(events.steps, (), gabc, with_words=False).melody if gabc else None))
    scored.sort(key=lambda ts: -1 if ts[1] is None else ts[1], reverse=True)
    words: dict[str, float | None] = {}
    for t, _ in scored[:SHORTLIST]:
        gabc = gabc_of(t)
        words[t.target] = agreement(events.steps, events.words, gabc).words if gabc else None
    evidence["candidates"] = [{"target": t.target, "melody": s, "words": words.get(t.target)} for t, s in scored[:SHORTLIST]]
    if not scored:
        return Entry(rel, None, "proposed", evidence)
    by_name = name_match(rel, h, by, scored, chants)
    if by_name:
        best, score, name = by_name
        evidence["melody"] = score
        evidence["words"] = words[best.target] if best.target in words else (
            agreement(events.steps, events.words, gabc_of(best) or "").words if gabc_of(best) else None)
        evidence["name"] = name
        if by == "kind":
            evidence["by"] = "name"
        return Entry(rel, best.target, "matched", evidence)
    best, score = scored[0]
    runner = next((s for _, s in scored[1:] if s is not None), 0.0)
    text = words.get(best.target)
    evidence["melody"] = score
    evidence["words"] = text
    if score is None:
        return Entry(rel, best.target if len(scored) == 1 and by != "kind" else None, "proposed", evidence)
    other_words = text is not None and text < OTHER_WORDS
    same_words = text is not None and text >= WORDS
    # Clearly the best: by melody, or (two settings of one melody: Easter
    # week's Ite and the rest of Paschaltide's) by its words.
    runner_text = next((words.get(t.target) for t, _ in scored[1:]), None)
    clear = score - runner >= MARGIN or (text is not None and runner_text is not None and text - runner_text >= MARGIN)
    if by != "kind" and clear and not other_words and (score >= MATCHED or (same_words and score >= DIFFERS)):
        return Entry(rel, best.target, "matched", evidence)
    if by == "kind" and clear and score >= MATCHED and same_words:
        evidence["by"] = "melody and words"                         # across the volume, but both say so
        return Entry(rel, best.target, "matched", evidence)
    if score >= MATCHED and by == "kind":
        return Entry(rel, best.target, "proposed", evidence)      # found by melody alone: a person confirms
    if len(scored) == 1 and score < DIFFERS:
        return Entry(rel, best.target, "melody-differs", evidence)
    return Entry(rel, best.target, "proposed", evidence)


def name_match(rel: str, h: Hints, by: str, scored: list[tuple[Target, float | None]],
               chants: dict[str, Any]) -> tuple[Target, float | None, str] | None:
    """The one candidate the file's own name names, with its melody score and
    the name that agreed; None when the name does not settle it."""
    if by in ("folder", "name"):
        if len(scored) == 1 and numbered(h):
            return scored[0][0], scored[0][1], rel.split("/")[-1].split(".")[0]
        return None
    fits = [(t, s, name) for t, s in scored if (name := named(rel, t, chants))]
    if len(fits) != 1:
        return None
    # Found across the whole volume, with no page: a melody that disagrees says
    # it is another chant with the same opening words.
    if by == "kind" and fits[0][1] is not None and fits[0][1] < DIFFERS:
        return None
    return fits[0]


def settle_duplicates(entries: list[Entry]) -> None:
    """Two files matched to one target: the one named for it keeps it, then the
    better melody; the other is proposed."""
    by_target: dict[str, list[Entry]] = {}
    for e in entries:
        if e.status == "matched" and e.target:
            by_target.setdefault(e.target, []).append(e)
    for same in by_target.values():
        if len(same) < 2:
            continue
        same.sort(key=lambda e: (bool(e.evidence.get("name")), e.evidence.get("melody") or 0.0), reverse=True)
        for e in same[1:]:
            e.status = "proposed"
            e.evidence["note"] = f"{same[0].file} matched {e.target} better"


HEADER = """\
# Which part of the catalogue each transcription in data/typeset/src/ is.
# Proposed by `uv run noh typeset-match` (pipeline/typeset/match.py), from each
# file's volume, page reference, name and folder, confirmed by comparing its
# melody with GregoBase's chant for the part. Only `matched` entries are
# rendered for the site; the admin screen's Review queues settle the rest.
#
# target: part:<slug>/<part>[:<variant>], movement:<slug>/<movement>, piece:<slug>
# status: matched | proposed | melody-differs | broken (and, from an editor's
#   choice in the admin screen, no-match | other-setting)
# source: editor (a person settled it; never changed here) | render (LilyPond
#   could not draw it; evidence.hash is the render it failed at, and the mark
#   goes when the file changes)
# evidence.melody: how much of the file's melody the chant has, in order (0-1),
#   with GregoBase's "ij.", "iij." and "Gloria Patri. E u o u a e" written out.
# evidence.words: how much of the file's words the chant has (0-1). Both at
#   0.85 or more is the strongest match there is.
# evidence.name: the file is named for its target (matched on that, whatever
#   the melody and words say).
"""


def load(path: Path = PARTS_FILE) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return list(yaml.safe_load(path.read_text(encoding="utf-8")) or [])


#: The values of a typeset:<file> `match` correction that are not a target.
NO_MATCH = "none"
OTHER_SETTING = "other-setting"
#: The statuses only a person gives: the file is not a part the catalogue has.
SETTLED = {NO_MATCH: "no-match", OTHER_SETTING: "other-setting"}


def settled(entry: dict[str, Any]) -> str | None:
    """What a `match` correction would say about this entry now: its target
    when matched, none or other-setting when a person settled it so, and None
    while it is undecided (proposed, melody-differs, broken)."""
    status = entry.get("status")
    if status == "matched":
        return str(entry["target"]) if entry.get("target") else None
    return next((value for value, st in SETTLED.items() if st == status), None)


def with_choices(entries: list[dict[str, Any]], choices: dict[str, str]) -> list[dict[str, Any]]:
    """parts.yml with the editors' choices applied: {file: a target, none or
    other-setting} (typeset:<file> `match` corrections, data/corrections.yml).
    A chosen target is the chosen file's: a file the matcher gave it to goes
    back to proposed, with a note."""
    chosen = {value: file for file, value in choices.items() if ":" in value}
    out: list[dict[str, Any]] = []
    for e in entries:
        value = choices.get(str(e["file"]))
        if value is None:
            if e.get("status") == "matched" and e.get("target") in chosen:
                evidence = {**(e.get("evidence") or {}), "note": f"an editor chose {chosen[e['target']]} for {e['target']}"}
                e = {**e, "status": "proposed", "evidence": evidence}
            out.append(e)
            continue
        if ":" in value:
            out.append({**e, "target": value, "status": "matched", "source": "editor"})
        else:
            out.append({**e, "target": None, "status": SETTLED[value], "source": "editor"})
    return out


def save(entries: list[Entry], path: Path = PARTS_FILE) -> None:
    body = yaml.safe_dump([e.as_dict() for e in entries], sort_keys=False, allow_unicode=True, width=120)
    path.write_text(HEADER + "\n" + body, encoding="utf-8")


def run(src: Path = SRC, path: Path = PARTS_FILE, catalog_path: Path = DATA / "catalog.json",
        chants_path: Path = DATA / "chants.json", read_events: Any = None,
        forget_render_failures: bool = False) -> list[Entry]:
    """`forget_render_failures`: decide every file afresh, however it last
    rendered (after a change to what counts as a failure)."""
    from pipeline.offset import load_page_map
    from pipeline.typeset.events import read_all

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    chants = json.loads(chants_path.read_text(encoding="utf-8")).get("chants", {})
    maps: dict[str, Any] = {}

    def printed(ref: str) -> int | None:
        vol, pdf = ref.split("/")[0], int(ref.split("/")[1])
        if vol not in maps:
            maps[vol] = load_page_map(vol)
        return maps[vol].to_printed(pdf)

    all_targets = targets(catalog, printed)
    files = sorted(src.rglob("*.ly"))
    events = (read_events or read_all)(files)
    previous = {e["file"]: e for e in load(path)}
    entries: list[Entry] = []
    for f in files:
        rel = f.relative_to(src).as_posix()
        s = previous.get(rel) or {}
        if s.get("source") == "editor" or (s.get("source") == "render" and not forget_render_failures
                                           and still_fails(f, s)):
            entries.append(Entry(rel, s.get("target"), str(s["status"]), dict(s.get("evidence") or {}),
                                 str(s["source"])))
            continue
        entries.append(decide(rel, f.read_text(encoding="utf-8"), events[f], all_targets, chants))
    settle_duplicates(entries)
    save(entries, path)
    return entries


def still_fails(path: Path, entry: dict[str, Any]) -> bool:
    """A file marked broken because it failed to render stays so until it
    changes: the mark names the render hash it failed at."""
    from pipeline.typeset.render import source_hash
    return (entry.get("evidence") or {}).get("hash") == source_hash(path.read_text(encoding="utf-8"))


def mark_render_failures(failures: dict[str, str], path: Path = PARTS_FILE, src: Path = SRC) -> list[str]:
    """Mark files that LilyPond could not draw as broken, with the reason and the
    hash they failed at, so the site keeps their scans and the admin screen's
    Typeset errors queue lists them. Returns the files marked."""
    from pipeline.typeset.render import source_hash
    marked = []
    entries = []
    for e in load(path):
        why = failures.get(e["file"])
        if why is None or e.get("source") == "editor":
            entries.append(Entry(e["file"], e.get("target"), str(e["status"]), dict(e.get("evidence") or {}),
                                 str(e.get("source", "match"))))
            continue
        evidence = {**(e.get("evidence") or {}), "error": why, "was": e["status"],
                    "hash": source_hash((src / e["file"]).read_text(encoding="utf-8"))}
        entries.append(Entry(e["file"], e.get("target"), "broken", evidence, "render"))
        marked.append(e["file"])
    save(entries, path)
    return marked


__all__ = [
    "MATCHED",
    "NO_MATCH",
    "OTHER_SETTING",
    "PARTS_FILE",
    "SETTLED",
    "Entry",
    "Hints",
    "Target",
    "candidates",
    "catalogue_name",
    "decide",
    "file_name",
    "hints",
    "load",
    "mark_render_failures",
    "name_match",
    "named",
    "numbered",
    "run",
    "settle_duplicates",
    "settled",
    "still_fails",
    "targets",
    "with_choices",
]
