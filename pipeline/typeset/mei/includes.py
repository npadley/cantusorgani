"""The ``.ily`` files a LilyPond source actually loads (card C5).

``ConversionInputs.include_sha256`` used to hash every file in ``data/typeset/include/``, so
editing any include invalidated every approval. It now hashes only the transitive closure of the
files a source ``\\include``s.

LilyPond searches the including file's own directory first, then the ``--include`` path (here
``data/typeset/include``). A name found in neither is one of LilyPond's own files
(``gregorian.ly``) and is not ours to hash. Comments (``%`` and ``%{ %}``) and string literals are
skipped, so a commented-out ``\\include`` does not count.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

_TOKEN = re.compile(
    r'"(?:\\.|[^"\\])*"'  # a string literal
    r"|%\{.*?%\}"  # a block comment
    r"|%[^\n]*"  # a line comment
    r'|\\include\s+"([^"\\\n]+)"',  # the thing we want
    re.DOTALL,
)


def included_names(text: str) -> list[str]:
    """The ``\\include "name"`` targets in ``text``, in order, ignoring comments and strings."""
    return [m.group(1) for m in _TOKEN.finditer(text) if m.group(1) is not None]


def _resolve(name: str, includer: Path, include_dir: Path) -> Path | None:
    for base in (includer.parent, include_dir):
        candidate = (base / name).resolve()
        if candidate.is_file():
            return candidate
    return None


def include_closure(source: Path, include_dir: Path) -> list[Path]:
    """The files ``source`` loads through ``\\include``, transitively, sorted by path name.

    ``source`` itself is not part of the result (its own bytes are ``source_sha256``)."""
    seen: dict[Path, None] = {}
    stack = [source.resolve()]
    visited = {source.resolve()}
    while stack:
        current = stack.pop()
        for name in included_names(current.read_text(encoding="utf-8")):
            found = _resolve(name, current, include_dir.resolve())
            if found is None or found in visited:
                continue
            visited.add(found)
            seen[found] = None
            stack.append(found)
    return sorted(seen, key=lambda p: (p.name, p.as_posix()))


def include_digest(source: Path, include_dir: Path) -> str:
    """sha256 of the closure as ``name NUL text NUL`` in name order."""
    digest = hashlib.sha256()
    for path in include_closure(source, include_dir):
        digest.update(f"{path.name}\0{path.read_text(encoding='utf-8')}\0".encode())
    return digest.hexdigest()
