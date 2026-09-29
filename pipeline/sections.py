"""A Proper's sections: what the book prints on it, in order.

A section is one entry of a piece's `sections` list in the catalogue:

    {"kind": "gradual", "n": 2, "variant": "", "system": 15, "ref": "noh1/0052/003",
     "gregobase_id": 1234, "placed": "label", "score": 1.0}

- `kind`: introit | gradual | alleluia | tract | sequence | hymn | offertory |
  communion | other.
- `n`: the 2nd (3rd ...) of its kind on the piece; absent when it is alone.
- `variant`: "paschal" (and other seasonal forms), or "".
- `system` / `ref`: its first system, counting from 0, as the piece's own list;
  a section printed elsewhere has `borrowed_*` fields instead.
- A section runs until the next one starts.

A section is named `part:<slug>/<kind>`, with `:<n>` or `:<variant>` -- the
names corrections, review keys and data/typeset/parts.yml have always used.
Everything that names a section goes through `suffix` and `target` here.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

KINDS = ("introit", "gradual", "alleluia", "tract", "sequence", "hymn", "offertory", "communion", "other")


def suffix(section: Mapping[str, Any]) -> str:
    """The part of a section's name after its kind: "" when it is alone,
    ":2" for the second of its kind, ":paschal" for a seasonal form."""
    n = section.get("n")
    variant = section.get("variant") or ""
    return f":{n}" if n else (f":{variant}" if variant else "")


def target(slug: str, section: Mapping[str, Any]) -> str:
    """The section's name: part:<slug>/<kind>[:<n>|:<variant>]."""
    return f"part:{slug}/{section['kind']}{suffix(section)}"


def named(section: Mapping[str, Any], kind: str, sub: str = "") -> bool:
    """Whether a section is the one `part:<slug>/<kind>[:<sub>]` names."""
    return section.get("kind") == kind and suffix(section)[1:] == sub


def of(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A piece's sections, printed and borrowed."""
    return list(piece.get("sections") or [])


def printed(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The sections printed on the piece itself, in order: each has a start."""
    return [s for s in of(piece) if "system" in s]


def split_variant(variant: str) -> tuple[int | None, str]:
    """A part's old variant as (n, variant): "2" is the 2nd of its kind,
    "paschal" a seasonal form."""
    return (int(variant), "") if variant.isdigit() else (None, variant)


def record(kind: str, variant: str = "", **fields: Any) -> dict[str, Any]:
    """A section record, with `n` split out of a numbered variant."""
    n, variant = split_variant(variant or "")
    out: dict[str, Any] = {"kind": kind}
    if n is not None:
        out["n"] = n
    out["variant"] = variant
    out.update(fields)
    return out


def from_part(part: Mapping[str, Any]) -> dict[str, Any]:
    """A schema-2 part record (`part`, variant "1"/"2"/"paschal") as a section."""
    rest = {k: v for k, v in part.items() if k not in ("part", "variant")}
    return record(str(part["part"]), str(part.get("variant") or ""), **rest)


__all__ = ["KINDS", "from_part", "named", "of", "printed", "record", "split_variant", "suffix", "target"]
