"""`noh typeset-mei-audit`: the catalogue audit, written as JSON. No LilyPond run."""

from __future__ import annotations

import dataclasses
import json
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any

from pipeline.typeset.lilypond import INCLUDE
from pipeline.typeset.match import PARTS_FILE, SRC, load
from pipeline.typeset.mei.audit import audit_sources


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, Fraction):
        return str(value)
    raise TypeError(f"not JSON serialisable: {type(value).__name__}")


def audit_command(out: Path) -> int:
    report = audit_sources(SRC, load(PARTS_FILE), INCLUDE)
    text = json.dumps(dataclasses.asdict(report), indent=2, sort_keys=True, default=_json_default)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")
    classes = Counter(source.classification for source in report.sources)
    summary = ", ".join(f"{n} {name}" for name, n in sorted(classes.items()))
    print(f"audited {len(report.sources)} sources ({summary}); "
          f"{len(report.absent_targets)} absent targets; wrote {out}")
    return 0
