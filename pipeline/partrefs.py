"""Parts a Proper prints by reference, read from the page's text layer.

A feast rarely prints all its parts: St Lucy's page reads "Introitus.
Dilexisti justitiam, Pars IV, p. 107." above her music and "Offertorium.
Afferentur regi, Pars IV, p. 97. Communio. Principes persecuti sunt, ibid."
below it. The index captured only the first of these. Without the rest,
segmentation would look for an Offertory in her own seven systems and force
one onto the wrong music.

A Proper's reference lines lie in its zone: from its own heading to the next
heading, in reading order. The heading may sit at the foot of the page before
its music (St Thomas, NOH3 p. 26-27).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from pipeline.catalog import parse_reference
from pipeline.indexextract import feast_date


@dataclass(frozen=True)
class Line:
    page: int          # pdf page
    y: float           # top, in points
    text: str


def is_heading(text: str) -> bool:
    """A feast's heading: dated ("21. DECEMBRIS. - S. THOMAE"), "EADEM DIE",
    or a line of capitals ("FERIA SEXTA POST DOMINICAM I PASSIONIS")."""
    if re.search(r"\bEADEM\s+DIE\b", text) or feast_date(text) is not None:
        return True
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 8 or sum(c.isupper() for c in letters) < 0.85 * len(letters):
        return False
    return len(re.findall(r"[A-Z]{4,}", text)) >= 2


_REF = re.compile(
    r"\b(?P<label>Introitus|Graduale|Tractus|Sequentia|Offertorium|Communio|Alleluia,\s*alleluia)\b\.?"
    r"(?P<body>[^.]{0,90}?(?:ut\s+supra|ut\s+infra|ibid\S*|Pars\s+\S+)\s*,?\s*(?:p\s*\.?\s*\d{1,3}|\d{1,3})?)")
_PART = {"introitus": "introit", "graduale": "gradual", "tractus": "tract", "sequentia": "sequence",
         "offertorium": "offertory", "communio": "communion"}


def reference_parts(text: str, volume: str) -> list[tuple[str, str, int]]:
    """(part, volume, printed page) for each part named by reference. "ibid."
    is the reference before it; "ut supra" this volume."""
    out: list[tuple[str, str, int]] = []
    previous = volume
    # The verse sign ("V.", OCR'd "~." or "t.") is not a sentence end.
    text = re.sub(r"(?<![A-Za-z])[V~t✝]\s*\.\s", "V ", text)
    for m in _REF.finditer(text):
        label = m.group("label").lower()
        part = "alleluia" if label.startswith("alleluia") else _PART[label]
        body = m.group("body")
        where = parse_reference(body, previous if "ibid" in body.lower() else volume)
        if where is None:
            continue
        previous = where[0]
        if not any(p == part for p, _, _ in out):
            out.append((part, where[0], where[1]))
    return out


def zone_text(lines: list[Line], start: tuple[int, float]) -> str:
    """The text of a Proper's zone: after its own heading (the last heading
    before its first system, on that page or the one before), up to the next
    heading after its first system. `start` is (pdf page, y) of that system."""
    ordered = sorted(lines, key=lambda ln: (ln.page, ln.y))
    before = [ln for ln in ordered if (ln.page, ln.y) < start and ln.page >= start[0] - 1]
    heading = next((ln for ln in reversed(before) if is_heading(ln.text)), None)
    begin = (heading.page, heading.y) if heading else start
    zone: list[str] = []
    for ln in ordered:
        if (ln.page, ln.y) <= begin:
            continue
        if (ln.page, ln.y) > start and is_heading(ln.text):
            break
        zone.append(ln.text)
    return " ".join(zone)


def page_lines(page: object, pdf_page: int) -> list[Line]:
    """Lines of a pymupdf page's text layer, top to bottom."""
    lines: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
    for x0, y0, _x1, _y1, word, block, line, _n in page.get_text("words"):   # type: ignore[attr-defined]
        lines.setdefault((block, line), []).append((y0, x0, word))
    out = [Line(pdf_page, min(w[0] for w in words), " ".join(w[2] for w in sorted(words, key=lambda w: w[1])))
           for words in lines.values()]
    return sorted(out, key=lambda ln: ln.y)


__all__ = ["Line", "is_heading", "page_lines", "reference_parts", "zone_text"]
