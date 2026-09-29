"""`noh typeset-check`: the typeset sources are safe to read and their map is
sound. Needs no LilyPond, so it runs in every CI build:

- every source and include file passes the source check;
- data/typeset/parts.yml has one entry for every source file, and only for them;
- every target it names exists in the catalogue, statuses are known, and no two
  files are matched to one target (with the editors' choices from
  data/corrections.yml applied).
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from pipeline.typeset.importer import INCLUDES
from pipeline.typeset.lilypond import INCLUDE
from pipeline.typeset.match import PARTS_FILE, SRC, targets
from pipeline.typeset.source_check import check_file
from pipeline.volumes import DATA

STATUSES = frozenset({"matched", "proposed", "melody-differs", "broken", "no-match", "other-setting"})


def problems(src: Path = SRC, include: Path = INCLUDE, parts: Path = PARTS_FILE,
             catalog_path: Path = DATA / "catalog.json") -> list[str]:
    out: list[str] = []
    files = sorted(src.rglob("*.ly"))
    for path in [*files, *sorted(include.glob("*.ily"))]:
        for p in check_file(path, frozenset(INCLUDES)):
            out.append(f"{path.relative_to(src.parents[2])}: {p}")
    from pipeline.typeset.manifest import effective
    # With the editors' choices: a part they chose must still exist too.
    entries: list[dict[str, Any]] = effective(parts)
    have = {f.relative_to(src).as_posix() for f in files}
    listed = Counter(str(e.get("file")) for e in entries)
    out += [f"parts.yml: {f} is listed {n} times" for f, n in listed.items() if n > 1]
    out += [f"parts.yml: {f} has no source file in data/typeset/src/" for f in sorted(set(listed) - have)]
    out += [f"parts.yml: {f} has no entry; run `uv run noh typeset-match`" for f in sorted(have - set(listed))]
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    known = {t.target for t in targets(catalog, lambda ref: None)}
    matched: Counter[str] = Counter()
    for e in entries:
        status, target = e.get("status"), e.get("target")
        if status not in STATUSES:
            out.append(f"parts.yml: {e.get('file')} has status {status!r}; it is one of {', '.join(sorted(STATUSES))}")
        if target is not None and target not in known:
            out.append(f"parts.yml: {e.get('file')} names {target}, which is not in the catalogue "
                       "(renamed by a rebuild?); choose its part again")
        if status == "matched":
            if target is None:
                out.append(f"parts.yml: {e.get('file')} is matched to nothing")
            else:
                matched[str(target)] += 1
    out += [f"parts.yml: {n} files are matched to {t}; keep one" for t, n in matched.items() if n > 1]
    return out


__all__ = ["STATUSES", "problems"]
