"""`noh typeset-mei-audit` (catalogue audit, no LilyPond) and `noh typeset-mei-extract` (one source)."""

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
from pipeline.typeset.mei.extract import BUILD_ROOT, PinnedLilyPondRunner, extract_score
from pipeline.typeset.mei.model import LilyPondRunnerAdapter


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


def extract_command(
    source: Path,
    out: Path,
    runner: LilyPondRunnerAdapter | None = None,
    build_root: Path = BUILD_ROOT,
) -> int:
    """Extract one source: raw TSV under build_root/<digest>/events.tsv, IR as OUT/ir.json."""
    result = extract_score(source, runner=runner or PinnedLilyPondRunner(), build_root=build_root)
    for diagnostic in result.diagnostics:
        print(f"{diagnostic.severity}: {diagnostic.code}: {diagnostic.message}")
    if result.ir is None:
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "ir.json").write_text(
        json.dumps(result.ir.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"extracted {source.name}: {len(result.ir.events)} events; wrote {out / 'ir.json'}")
    return 1 if any(d.severity == "error" for d in result.diagnostics) else 0
