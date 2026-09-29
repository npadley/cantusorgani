"""Stable names for the review queue's items (data/review-queue.json).

An editor who looks at an item and finds it right records a `reviewed`
correction on it (target `review:<volume>/<kind>/<id>`). For that to survive a
rebuild of the catalogue, each item needs a name that depends only on what the
item is about -- the piece, part, movement or page -- never on the details the
pipeline found (a score, the system it guessed). Those details go into the
item's fingerprint instead: the value a review confirms. When a rebuild changes
them, the fingerprint changes and the review lapses, so the item comes back.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

# What an item is about. A page identifies an item only when no piece does (a
# page whose staves could not be paired); otherwise it is where the pipeline
# placed something, a detail.
IDENTITY = ("volume", "kind", "piece", "part", "variant", "movement", "title",
            "pdf_pages", "printed_page", "printed_pages")
# Kinds where the system is the subject, not a detail: an uncertain movement is
# "this system was read as a Sanctus", and a piece can have several.
BY_SYSTEM = frozenset({"uncertain_movement"})
KEY = re.compile(r"^review:[a-z0-9]+/[a-z_]+/[0-9a-f]{8}(?:-\d+)?$")


def _digest(value: Any, length: int) -> str:
    text = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


def identity(item: dict[str, Any]) -> dict[str, Any]:
    out = {k: item[k] for k in IDENTITY if item.get(k) not in (None, "")}
    if item.get("piece") in (None, "") and item.get("pdf_page") is not None:
        out["pdf_page"] = item["pdf_page"]
    if item.get("kind") in BY_SYSTEM and item.get("ref"):
        out["ref"] = item["ref"]
    return out


def fingerprint(item: dict[str, Any]) -> str:
    """Everything the item says, hashed: what a review of it confirms."""
    return _digest({k: v for k, v in item.items() if k not in ("key", "fingerprint")}, 12)


def with_keys(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The queue with `key` and `fingerprint` on each item, in the same order.
    Two items about the same thing (rare) are told apart by a suffix in queue
    order."""
    seen: dict[str, int] = {}
    out = []
    for item in queue:
        volume = str(item.get("volume") or "noh5")
        base = f"review:{volume}/{item['kind']}/{_digest(identity(item), 8)}"
        seen[base] = seen.get(base, 0) + 1
        key = base if seen[base] == 1 else f"{base}-{seen[base]}"
        clean = {k: v for k, v in item.items() if k not in ("key", "fingerprint")}
        out.append({**clean, "key": key, "fingerprint": fingerprint(clean)})
    return out


__all__ = ["BY_SYSTEM", "IDENTITY", "KEY", "fingerprint", "identity", "with_keys"]
