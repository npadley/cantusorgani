"""Divide NOH8's office sections into the items of Vespers.

Each office section prints, in order: the psalm antiphons ("1. Ant. VIII. G"
in the margin, each ending on its "E u o u a e"), sometimes the first verses of
the psalm ("Ps. Dixit Dominus ..."), the chapter and its response, the hymn
(indexed by name), the versicle and its response, and the Magnificat antiphon
("Ad Magnificat, Antiphona."). A section may hold I and II Vespers, or several
Sundays, each under a heading printed between the systems.

`segment(systems)` places each item on the signals the page gives -- a margin
label, the text layer under the staff, the lines printed above the system, the
hymn index -- never by position alone. The result is a proposal: `noh
vespers-items` writes it for review; data/vespers-offices.yml holds the
reviewed offices.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from pipeline.vespers import normalise_tone


@dataclass(frozen=True)
class OfficeSystem:
    ref: str
    text: str          # the text layer under and over the staff
    margin: str        # a wide margin crop's OCR
    above: str = ""    # lines printed between the previous system and this one
    hymn: str | None = None   # the hymn index's title, when a hymn starts here


@dataclass
class Item:
    kind: str                  # antiphon | psalm-opening | hymn | versicle | magnificat-antiphon | response
    refs: list[str]
    number: int | None = None
    tone: str | None = None
    title: str | None = None
    psalm: str | None = None   # "Dixit Dominus", from "Ps. Dixit Dominus." near the antiphon


@dataclass
class Block:
    """One office: a Sunday, or I or II Vespers of a feast."""
    heading: str | None
    items: list[Item] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)   # rubrics printed in the block

    def antiphons(self) -> list[Item]:
        return [i for i in self.items if i.kind == "antiphon"]

    def magnificat(self) -> Item | None:
        return next((i for i in self.items if i.kind == "magnificat-antiphon"), None)


_ANT = re.compile(r"(?:^|[\s|(])([1-5I])\s*[.,]?\s*An[tc]\b\.?")
_MAGNIF = re.compile(r"Ad\s*M\s?a?g?n?", re.IGNORECASE)
_MAGNIF_ABOVE = re.compile(r"Ad\s+M\w*\s*,?\s*A\s?n?t", re.IGNORECASE)
_PSALM_START = re.compile(r"^\W{0,4}[I|l1]?\s?P[sS]\s?\.")
_PSALM_REF = re.compile(r"\bPs\.\s+([A-Z][\w\s,]{3,40}?)\.")
_VERSICLE = re.compile(r"^\W{0,6}(?:[Yy¥V℣]\s?[.,]|J\.I\s|\.LL\s|u\s?t!\s?jI\.)")
_HEADING = re.compile(
    r"(DOMINICA\s+[IVXL]+\.?\s+(?:ADVENTUS|POST\s+\w+|IN\s+\w+|DE\s+PASSIONE|QU\w+\s+SUPERFUIT\s+POST\s+\w+)"
    r"|DOMINICA\s+(?:IN\s+\w+|DE\s+PASSIONE|RESURRECTIONIS|INFRA\s+OCT\w*[^.]*)"
    r"|IN\s+(?:I|II|L|Il|1|11)\.?\s*VESPER\w*|FERIA\s+(?:SECUNDA|II|IV|VI)\b[^.]*)")
_END = re.compile(r"E\s*[uU]\s*[oa0]\s*[uU11]\s*a\s*[eéE]")


def antiphon_number(margin: str, text: str) -> int | None:
    """The psalm antiphon a margin or text label numbers: "3. Ant. IV. g" -> 3.
    OCR reads "1." as "I."."""
    for source in (margin, text[:60]):
        m = _ANT.search(source)
        if m:
            d = m.group(1)
            return 1 if d == "I" else int(d)
    return None


def tone_of(*sources: str) -> str | None:
    """The tone a label prints, from the first source that has one."""
    for source in sources:
        for m in re.finditer(r"(?:Ant[.,]?|Antiph\.?|^|\s)\s*((?:[IVXLHNUWil1]{1,5})[\s.,]*[A-Ga-g]\s*\d?\s*\*?|T\.?\s*pere\w*)",
                             source):
            tone = normalise_tone(m.group(1))
            if tone:
                return tone
    return None


def heading_of(text: str) -> str | None:
    m = _HEADING.search(text)
    if not m:
        return None
    h = " ".join(m.group(1).split())
    h = re.sub(r"IN\s+(?:II|11)\.?\s*VESPER\w*", "IN II. VESPERIS", h)
    return re.sub(r"IN\s+(?:I|L|Il|1)\.?\s*VESPER\w*", "IN I. VESPERIS", h)


def ended(item: Item, texts: dict[str, str]) -> bool:
    """Whether an antiphon's last system closes on its "E u o u a e"."""
    return bool(_END.search(texts.get(item.refs[-1], "")))


def segment(systems: list[OfficeSystem]) -> list[Block]:
    """The blocks of one office section, each with its items in print order."""
    texts = {s.ref: s.text for s in systems}
    blocks: list[Block] = [Block(None)]
    current: Item | None = None
    seen_magnificat = False
    pending_hymn: str | None = None     # an index title whose system turned out to be something else

    def start(item: Item) -> None:
        nonlocal current
        blocks[-1].items.append(item)
        current = item

    for s in systems:
        heading = heading_of(s.above) or heading_of(s.text[:80])
        number = antiphon_number(s.margin, s.text)
        labelled = number is not None and re.search(r"An[tc]", s.margin + s.text[:60]) is not None
        if heading and (blocks[-1].items or blocks[-1].heading):
            blocks.append(Block(heading))
            seen_magnificat, current = False, None
        elif labelled and number == 1 and seen_magnificat:
            blocks.append(Block(None))             # the numbering starts again
            seen_magnificat, current = False, None
        elif heading:
            blocks[-1].heading = heading
        for rubric in re.findall(r"(Antiphon\w*\s+et\s+Psalmi[^.]*\.|Capitulum,\s*Hymn\w*[^:]*:|"
                                 r"Psalmi\s+de\s+Dominica)", s.above + " " + s.text):
            blocks[-1].notes.append(" ".join(rubric.split()))
        psalm_ref = _PSALM_REF.search(s.above + " " + s.text)

        if (_MAGNIF_ABOVE.search(s.above) or _MAGNIF.match(s.margin.strip())
                or re.search(r"Ad\s*Magnif", s.text[:40])):
            start(Item("magnificat-antiphon", [s.ref], tone=tone_of(s.margin, s.text)))
            seen_magnificat = True
        elif labelled:
            start(Item("antiphon", [s.ref], number=number, tone=tone_of(s.margin, s.text)))
            pending_hymn = s.hymn or pending_hymn
        elif "HYMNUS" in s.above.upper() or (s.hymn and not pending_hymn):
            start(Item("hymn", [s.ref], title=s.hymn or pending_hymn))
            pending_hymn = None
        elif _PSALM_START.search(s.text) and current is not None and current.kind in ("antiphon", "psalm-opening"):
            num = current.number
            start(Item("psalm-opening", [s.ref], number=num, tone=current.tone))
        elif _VERSICLE.search(s.text) or re.match(r"[VYR¥]\s?[.,]", s.margin):
            if current is not None and current.kind == "versicle" and len(current.refs) < 2:
                current.refs.append(s.ref)
            else:
                start(Item("versicle", [s.ref]))
        elif current is not None and current.kind in ("antiphon", "magnificat-antiphon") and not ended(current, texts) or current is not None and current.kind in ("psalm-opening", "hymn"):
            current.refs.append(s.ref)
        elif current is not None and current.kind in ("antiphon", "magnificat-antiphon") and ended(current, texts):
            # An unlabelled system after a finished antiphon: the next antiphon
            # of a section that numbers only some (Easter's "Haec dies").
            start(Item("unlabelled", [s.ref]))
        elif current is not None:
            current.refs.append(s.ref)
        if psalm_ref and current is not None and current.kind in ("antiphon", "psalm-opening"):
            current.psalm = current.psalm or " ".join(psalm_ref.group(1).split())
    return [b for b in blocks if b.items]


__all__ = ["Block", "Item", "OfficeSystem", "antiphon_number", "heading_of", "segment", "tone_of"]


# ------------------------------------------------------------ offices ---

@dataclass(frozen=True)
class OfficeSpec:
    """One office the lineup builds: whose texts (Divinum Officium), which
    Vespers, and the NOH8 sections that print it (searched first)."""
    id: str
    do_key: str
    vespers: str                          # "I" | "II"
    sections: tuple[str, ...]
    keys: tuple[str, ...] = ()            # calendar keys it serves
    block: int | None = None              # a section of several Sundays: which one


def _spec(id_: str, do_key: str, vespers: str, *sections: str, keys: tuple[str, ...] = (),
          block: int | None = None) -> OfficeSpec:
    return OfficeSpec(id_, do_key, vespers, tuple(f"vesperae-{s}" for s in sections), keys, block)


ADV = "dominicae-i-iv-adventus"
OFFICE_SPECS: tuple[OfficeSpec, ...] = (
    *(_spec(f"adv{n}", f"Tempora/Adv{n}-0", "II", ADV, keys=(f"tempora:Adv{n}-0",), block=n - 1)
      for n in range(1, 5)),
    _spec("nativitas-1", "Sancti/12-25", "I", "in-nativitate-domini", keys=("sancti:12-25",)),
    _spec("nativitas-2", "Sancti/12-25", "II", "in-nativitate-domini", keys=("sancti:12-25",)),
    _spec("nat1", "Tempora/Nat1-0", "II", "dominica-infra-octavam-nativitatis", "in-nativitate-domini",
          keys=("tempora:Nat1-0",)),
    _spec("circumcisio-1", "Sancti/01-01", "I", "in-circumcisione-domini", keys=("sancti:01-01",)),
    _spec("circumcisio-2", "Sancti/01-01", "II", "in-circumcisione-domini", keys=("sancti:01-01",)),
    _spec("nomen-1", "Tempora/Nat2-0", "I", "ssmi-nominis-jesu", keys=("tempora:Nat2-0",)),
    _spec("nomen-2", "Tempora/Nat2-0", "II", "ssmi-nominis-jesu", keys=("tempora:Nat2-0",)),
    _spec("epiphania-1", "Sancti/01-06", "I", "in-epiphania-domini", keys=("sancti:01-06",)),
    _spec("epiphania-2", "Sancti/01-06", "II", "in-epiphania-domini", keys=("sancti:01-06",)),
    _spec("familia-1", "Tempora/Epi1-0", "I", "s-familiae-jesu-mariae-joseph", keys=("tempora:Epi1-0",)),
    _spec("familia-2", "Tempora/Epi1-0", "II", "s-familiae-jesu-mariae-joseph", keys=("tempora:Epi1-0",)),
    _spec("septuagesima", "Tempora/Quadp1-0", "II", "dominica-in-septuagesima", keys=("tempora:Quadp1-0",)),
    _spec("sexagesima", "Tempora/Quadp2-0", "II", "dominica-in-sexagesima", keys=("tempora:Quadp2-0",)),
    _spec("quinquagesima", "Tempora/Quadp3-0", "II", "dominica-in-quinquagesima", keys=("tempora:Quadp3-0",)),
    *(_spec(f"quad{n}", f"Tempora/Quad{n}-0", "II", "dominicae-i-iv-quadragesimae", keys=(f"tempora:Quad{n}-0",))
      for n in range(1, 5)),
    _spec("passio", "Tempora/Quad5-0", "II", "dominica-de-passione", keys=("tempora:Quad5-0",)),
    _spec("palmae", "Tempora/Quad6-0", "II", "dominica-in-palmis", "dominica-de-passione", keys=("tempora:Quad6-0",)),
    _spec("pascha", "Tempora/Pasc0-0", "II", "dominica-resurrectionis", keys=("tempora:Pasc0-0",)),
    _spec("albis", "Tempora/Pasc1-0", "II", "dominica-in-albis", keys=("tempora:Pasc1-0",)),
    *(_spec(f"pasc{n}", f"Tempora/Pasc{n}-0", "II", "dominicae-ii-v-post-pascha", "dominica-in-albis",
            keys=(f"tempora:Pasc{n}-0",)) for n in range(2, 6)),
    _spec("ascensio-1", "Tempora/Pasc5-4", "I", "in-ascensione-domini", keys=("tempora:Pasc5-4",)),
    _spec("ascensio-2", "Tempora/Pasc5-4", "II", "in-ascensione-domini", keys=("tempora:Pasc5-4",)),
    _spec("pasc6", "Tempora/Pasc6-0", "II", "dominica-infra-octavam-ascensionis", "in-ascensione-domini",
          keys=("tempora:Pasc6-0",)),
    _spec("pentecoste-1", "Tempora/Pasc7-0", "I", "in-festo-pentecostes", "dominica-infra-octavam-ascensionis",
          keys=("tempora:Pasc7-0",)),
    _spec("pentecoste-2", "Tempora/Pasc7-0", "II", "in-festo-pentecostes", "dominica-infra-octavam-ascensionis",
          keys=("tempora:Pasc7-0",)),
    _spec("trinitas-1", "Tempora/Pent01-0", "I", "in-festo-ssmae-trinitatis", keys=("tempora:Pent01-0",)),
    _spec("trinitas-2", "Tempora/Pent01-0", "II", "in-festo-ssmae-trinitatis", keys=("tempora:Pent01-0",)),
    _spec("corpus-1", "Tempora/Pent01-4", "I", "corporis-christi", keys=("tempora:Pent01-4",)),
    _spec("corpus-2", "Tempora/Pent01-4", "II", "corporis-christi", keys=("tempora:Pent01-4",)),
    _spec("cor-1", "Tempora/Pent02-5", "I", "ssmi-cordis-jesu", keys=("tempora:Pent02-5",)),
    _spec("cor-2", "Tempora/Pent02-5", "II", "ssmi-cordis-jesu", keys=("tempora:Pent02-5",)),
    *(s for d, sec in (("12-08", "immaculatae-conceptionis-b-m-v"), ("02-02", "purificatio-b-m-v"),
                       ("03-19", "s-joseph-sponsi-b-m-v-conf"), ("03-25", "annuntiatio-b-m-v"),
                       ("06-24", "nativitas-s-joannis-baptistae"), ("06-29", "ss-petri-et-pauli-apostolorum"),
                       ("07-01", "pretiosissimi-sanguinis-d-n-j-c"), ("08-15", "assumptio-b-m-v"),
                       ("10-DU", "d-n-jesu-christi-regis"), ("11-01", "omnium-sanctorum"),
                       ("11-09", "commune-dedicationis-ecclesiae"))
      for s in (_spec(f"{d}-1", f"Sancti/{d}", "I", sec, keys=(f"sancti:{d}",)),
                _spec(f"{d}-2", f"Sancti/{d}", "II", sec, keys=(f"sancti:{d}",)))),
)
EXCLUDED_SECTIONS = frozenset({
    "vesperae-dominica-ad-vesperas", "vesperae-dominica-ad-completorium", "vesperae-antiphonae-finales-b-m-v",
})


def _latin_key(text: str, length: int = 24) -> str:
    import unicodedata

    from pipeline.movements import condense
    text = text.replace("æ", "ae").replace("Æ", "Ae").replace("œ", "oe").replace("Œ", "Oe").replace("ǽ", "ae")
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().replace("*", "")
    return condense(plain)[:length]


def match_score(do_text: str, system_text: str) -> float:
    from pipeline.movements import movement_score_for
    key = _latin_key(do_text)
    return movement_score_for((key,), system_text) if len(key) >= 6 else 0.0


@dataclass(frozen=True)
class Found:
    section: str
    item: Item
    score: float


def best_item(do_text: str, candidates: list[tuple[str, Item]], texts: dict[str, str],
              prefer: tuple[str, ...], kinds: tuple[str, ...], number: int | None = None,
              after: str | None = None, allowed: set[int] | None = None) -> Found | None:
    """The printed item whose first system (or first two) reads best as `do_text`.

    The office's own sections come first: there an item labelled with the
    antiphon's own number (and printed after `after`, the previous one) is
    taken on a modest score, since the text layer often misses an antiphon's
    first words. Elsewhere -- a Common, a feast whose antiphons are "ut in"
    another -- only a strong reading counts."""
    scored: list[Found] = []
    for section, item in candidates:
        if item.kind not in kinds:
            continue
        joined = " ".join(texts.get(r, "") for r in item.refs[:2])
        score = max(match_score(do_text, texts.get(item.refs[0], "")), match_score(do_text, joined))
        scored.append(Found(section, item, round(score, 3)))
    own = [f for f in scored if f.section in prefer]
    strong_own = [f for f in own if f.score >= 0.7 and (allowed is None or id(f.item) in allowed or f.score >= 0.85)]
    if strong_own:
        return max(strong_own, key=lambda f: f.score)
    labelled = [f for f in own if number is not None and f.item.number == number and f.score >= 0.35
                and (after is None or f.item.refs[0] > after)
                and (allowed is None or id(f.item) in allowed)]
    if labelled:
        return min(labelled, key=lambda f: f.item.refs[0])
    elsewhere = [f for f in scored if f.score >= 0.75]
    if elsewhere:
        return max(elsewhere, key=lambda f: f.score)
    fair_own = [f for f in own if f.score >= 0.55 and (allowed is None or id(f.item) in allowed)]
    return max(fair_own, key=lambda f: f.score) if fair_own else None


def office_systems(catalog: dict[str, object], wide_cache: Path | None = None) -> dict[str, list[OfficeSystem]]:
    """Every NOH8 section's systems with their text, the lines printed above them,
    their wide margin reading and the hymn that starts there."""
    import json as _json

    import pymupdf

    from pipeline.evaluate import analyse_page
    from pipeline.margins import SLICES
    from pipeline.systemtext import PX_TO_PT, system_texts
    from pipeline.vespers import read_tone_margin
    from pipeline.volumes import load_volumes

    cache_path = wide_cache or (SLICES.parent / "margins-wide" / "noh8.json")
    wide: dict[str, str] = _json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    pieces = [p for p in catalog["pieces"] if p["volume"] == "noh8"]                 # type: ignore[index]
    texts: dict[str, str] = {}
    above: dict[str, str] = {}
    with pymupdf.open(load_volumes()["noh8"].path) as doc:
        for page_no in sorted({int(r.split("/")[1]) for p in pieces for r in p["systems"]}):
            page = doc[page_no - 1]
            boxes = analyse_page("noh8", page_no).boxes
            for i, (box, text) in enumerate(zip(boxes, system_texts("noh8", page_no), strict=False)):
                ref = f"noh8/{page_no:04d}/{i:03d}"
                prev = boxes[i - 1].bottom * PX_TO_PT if i else 0.0
                clip = pymupdf.Rect(0, prev, page.rect.width, box.top * PX_TO_PT)
                texts[ref] = text
                above[ref] = " ".join(page.get_text("text", clip=clip).split())
    changed = False
    for p in pieces:
        for ref in p["systems"]:
            if ref not in wide:
                png = SLICES / f"{ref}@2x.png"
                wide[ref] = read_tone_margin(png) if png.exists() else ""
                changed = True
    if changed:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(_json.dumps(wide, ensure_ascii=False), encoding="utf-8")
    out: dict[str, list[OfficeSystem]] = {}
    for p in pieces:
        hymns = {h["ref"]: h["title"] for h in p.get("hymns") or []}
        out[p["slug"]] = [OfficeSystem(r, texts.get(r, ""), wide.get(r, ""), above.get(r, ""), hymns.get(r))
                          for r in p["systems"]]
    return out


def _incipit(do_text: str) -> str:
    """"Rex pacíficus * magnificátus est ..." -> "Rex pacíficus"."""
    head = do_text.split("*")[0].strip().rstrip(",.:;")
    return head or " ".join(do_text.split()[:3])


def propose_offices(systems: dict[str, list[OfficeSystem]], do: dict[str, object]) -> dict[str, object]:
    """Each OFFICE_SPECS office aligned to NOH8's printed items, with a score
    for every placement (a DO text read against the page's text layer)."""
    blocks = {slug: segment(s) for slug, s in systems.items() if slug not in EXCLUDED_SECTIONS}
    texts = {s.ref: s.text for ss in systems.values() for s in ss}
    candidates = [(slug, item) for slug, bs in blocks.items() for b in bs for item in b.items]
    # Which Vespers each block prints: a heading says; a lone block serves both.
    in_vespers: dict[str, set[int]] = {"I": set(), "II": set()}
    for bs in blocks.values():
        for b in bs:
            h = (b.heading or "").upper()
            kinds = ({"II"} if re.search(r"\bII\.?\s*VESPER", h) else {"I"} if re.search(r"\bI\.?\s*VESPER", h)
                     else {"I", "II"} if len(bs) == 1 else {"I"} if b is bs[0] else {"II"})
            for v in kinds:
                in_vespers[v] |= {id(i) for i in b.items}
    offices: dict[str, object] = {}
    done: dict[tuple[str, str], dict[str, object]] = {}
    placed: dict[tuple[str, ...], dict[str, object]] = {}   # antiphon texts -> the office that placed them
    for spec in OFFICE_SPECS:
        office = do["offices"].get(spec.do_key)             # type: ignore[union-attr]
        if office is None:
            offices[spec.id] = {"error": f"no Divinum Officium text for {spec.do_key}"}
            continue
        part = office[spec.vespers]
        entry: dict[str, object] = {"do": spec.do_key, "vespers": spec.vespers, "keys": list(spec.keys)}
        allowed = in_vespers[spec.vespers]
        if spec.block is not None:
            own_blocks = blocks.get(spec.sections[0], [])
            allowed = {id(i) for i in own_blocks[spec.block].items} if spec.block < len(own_blocks) else set()
        texts_key = tuple(a["text"] for a in part["antiphons"])
        first = placed.get(texts_key)
        same_as_first = first is not None
        ants = []
        previous: str | None = None
        for n, a in enumerate(part["antiphons"], start=1):
            if same_as_first and isinstance(first["antiphons"], list):      # type: ignore[index]
                ants.append(dict(first["antiphons"][n - 1]))                 # type: ignore[index]
                continue
            found = best_item(a["text"], candidates, texts, spec.sections, ("antiphon", "unlabelled"),
                              number=n, after=previous, allowed=allowed)
            if found and found.section in spec.sections:
                previous = found.item.refs[0]
            row: dict[str, object] = {"n": n, "incipit": _incipit(a["text"]), "psalm": a["psalm"]}
            if found:
                row.update(refs=found.item.refs, tone=found.item.tone, score=found.score, section=found.section)
                opening = _opening_after(blocks[found.section], found.item)
                if opening:
                    row["opening"] = opening
            ants.append(row)
        entry["antiphons"] = ants if ants else "sunday"
        if part["magnificat"]:
            found = best_item(part["magnificat"], candidates, texts, spec.sections,
                              ("magnificat-antiphon", "unlabelled", "antiphon"))
            entry["magnificat"] = {"incipit": _incipit(part["magnificat"])}
            if found:
                entry["magnificat"].update(refs=found.item.refs, tone=found.item.tone,   # type: ignore[union-attr]
                                           score=found.score, section=found.section)
        hymn = office.get("hymn")
        if hymn:
            h = _hymn(hymn, candidates, spec.sections)
            entry["hymn"] = {"title": hymn} if h is None else h
        versicle = _versicle(blocks, spec, entry.get("hymn"), in_vespers)       # type: ignore[arg-type]
        if versicle:
            entry["versicle"] = versicle
        if part["chapter"]:
            entry["chapter"] = part["chapter"]
        offices[spec.id] = entry
        done[(spec.do_key, spec.vespers)] = entry
        if texts_key and texts_key not in placed:
            placed[texts_key] = entry
    return offices


def _opening_after(bs: list[Block], item: Item) -> list[str] | None:
    for b in bs:
        if item in b.items:
            i = b.items.index(item)
            nxt = b.items[i + 1] if i + 1 < len(b.items) else None
            if nxt is not None and nxt.kind == "psalm-opening":
                return nxt.refs
    return None


def _hymn(first_line: str, candidates: list[tuple[str, Item]], prefer: tuple[str, ...]) -> dict[str, object] | None:
    """The NOH8 hymn whose indexed title starts as Divinum Officium's first line,
    with the versicle printed after it. The first tone printed in the office's
    own section is preferred to an "alter tonus"."""
    want = _latin_key(first_line, 12)
    hits = [(slug, item) for slug, item in candidates
            if item.kind == "hymn" and item.title and _latin_key(item.title, 12)[:10] == want[:10]]
    if not hits:
        return None
    hits.sort(key=lambda h: (h[0] not in prefer, "tonus" in (h[1].title or "")))
    slug, item = hits[0]
    return {"title": item.title, "refs": item.refs, "section": slug}


def _versicle(blocks: dict[str, list[Block]], spec: OfficeSpec, hymn: dict[str, object] | None,
              in_vespers: dict[str, set[int]]) -> list[str] | None:
    """The versicle this Vespers prints: in its own block, the first versicle
    before the Magnificat antiphon (II Vespers often prints its own); failing
    that, the one after the hymn."""
    for slug in spec.sections:
        for b in blocks.get(slug, []):
            if not any(id(i) in in_vespers[spec.vespers] for i in b.items):
                continue
            if spec.block is not None and blocks[slug].index(b) != spec.block:
                continue
            for i in b.items:
                if i.kind == "magnificat-antiphon":
                    break
                if i.kind == "versicle":
                    return i.refs
    if hymn and hymn.get("refs"):
        first = hymn["refs"][0]                                          # type: ignore[index]
        for bs in blocks.values():
            for b in bs:
                refs = [i.refs[0] for i in b.items]
                if first in refs:
                    for i in b.items[refs.index(first) + 1:]:
                        if i.kind == "versicle":
                            return i.refs
                        if i.kind in ("magnificat-antiphon", "antiphon"):
                            break
    return None
