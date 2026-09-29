"""What a rendered SVG must be before it is published: well-formed, a drawing
and nothing else.

LilyPond draws from files we do not control, so its output is checked before
it goes to R2: no scripts, no event handlers, no foreign content, and no links
outside the file (Cairo's glyphs are <use> references to #ids in the same
file). The site shows these only through <img>, where scripts never run, but a
published file can also be opened directly, and it must be harmless there too.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

SVG = "{http://www.w3.org/2000/svg}"
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
#: Elements a LilyPond/Cairo drawing uses. Anything else is refused.
ALLOWED = frozenset({"svg", "defs", "g", "path", "use", "rect", "clipPath", "symbol", "title", "desc",
                     "image", "mask", "linearGradient", "radialGradient", "stop", "pattern"})
_DOCTYPE = re.compile(rb"<!DOCTYPE|<!ENTITY", re.IGNORECASE)
_URL = re.compile(r"url\(\s*['\"]?\s*(?!#)", re.IGNORECASE)


def problems(data: bytes, expected_width_pt: float | None = None) -> list[str]:
    """Why this SVG may not be published; empty when it may."""
    if _DOCTYPE.search(data[:4096]) or b"<!ENTITY" in data:
        return ["has a DOCTYPE or ENTITY declaration"]
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        return [f"is not well-formed XML ({error})"]
    if root.tag != f"{SVG}svg":
        return [f"its root is {root.tag}, not svg"]
    out: list[str] = []
    for el in root.iter():
        name = el.tag.removeprefix(SVG)
        if name not in ALLOWED:
            out.append(f"has a <{name}> element")
        for attr, value in el.attrib.items():
            local = attr.rsplit("}", 1)[-1]
            if local.lower().startswith("on"):
                out.append(f"has an event handler ({local}) on <{name}>")
            if attr in (XLINK_HREF, "href") and not (value.startswith("#")
                                                      or (name == "image" and value.startswith("data:image/png;"))):
                out.append(f"<{name}> links outside the file ({value[:40]})")
            if _URL.search(value):
                out.append(f"<{name}> {local} points outside the file")
    if expected_width_pt is not None:
        width = root.get("width", "").removesuffix("pt")
        try:
            if abs(float(width) - expected_width_pt) > 1.0:
                out.append(f"is {width} wide, not {expected_width_pt:.0f}")
        except ValueError:
            out.append(f"has no width ({width!r})")
    return sorted(set(out))


def check_file(path: Path, expected_width_pt: float | None = None) -> list[str]:
    return problems(path.read_bytes(), expected_width_pt)


MM = 72 / 25.4
#: The width each SVG is drawn at, in points (render.py's paper widths).
WIDTHS = {"narrow.svg": 100 * MM, "wide.svg": 190 * MM}


def check_pdf(data: bytes) -> list[str]:
    if not data.startswith(b"%PDF-"):
        return ["is not a PDF"]
    if b"/JavaScript" in data or b"/JS " in data or b"/Launch" in data or b"/EmbeddedFile" in data:
        return ["carries script, a launch action or an embedded file"]
    return []


__all__ = ["WIDTHS", "check_file", "check_pdf", "problems"]
