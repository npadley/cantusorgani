"""The 1962 liturgical calendar, generated from Missalemeum.

Missalemeum is vendored (vendor/missalemeum, gitignored) and run in its own
isolated environment, because it needs Python >=3.13 plus dependencies this
project does not want. The output is plain JSON under data/calendar/, which is
git-tracked: the site never depends on Missalemeum at runtime, and a stranger
can rebuild the site without it.

NOH itself is a 1942 edition. The calendar is 1962. The design doc's rule holds:
the 1942 books are the substrate and the 1962 calendar is a projection over
them, so a 1942 piece may have no 1962 day (a suppressed octave, the pre-1955
Holy Week) and that must be recorded, not forced.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from pipeline.volumes import DATA, ROOT

VENDOR = ROOT / "vendor" / "missalemeum"
MISSALEMEUM_REPO = "https://github.com/mmolenda/missalemeum.git"
CALENDAR_DIR = DATA / "calendar"
DEFAULT_RANGE = (2024, 2050)

# Missalemeum's calendar imports only these; its web and PDF dependencies are
# not needed. `trans` is deliberately absent: only api/filters.py uses it, the
# calendar never imports that module, and its sdist is rejected by uv.
DEPENDENCIES = ("python-dateutil~=2.9.0", "PyYAML~=6.0.3", "mistune~=3.2.0", "click~=8.3.1")


def missalemeum_commit() -> str:
    if not (VENDOR / ".git").exists():
        raise RuntimeError(
            f"Missalemeum is not vendored at {VENDOR}.\n"
            f"  Fix: git clone --depth 1 {MISSALEMEUM_REPO} vendor/missalemeum"
        )
    result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=VENDOR,
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def export_command(first: int, last: int, out: Path) -> list[str]:
    command = ["uv", "run", "--isolated", "--no-project", "--python", "3.14"]
    for dependency in DEPENDENCIES:
        command += ["--with", dependency]
    command += ["python", str(ROOT / "scripts" / "missalemeum_export.py"),
                str(first), str(last), str(out)]
    return command


def generate(first: int = DEFAULT_RANGE[0], last: int = DEFAULT_RANGE[1],
             out: Path = CALENDAR_DIR) -> dict[str, object]:
    """Regenerate data/calendar/ and record exactly what produced it."""
    if first > last:
        raise ValueError(f"descending year range {first}-{last}")
    commit = missalemeum_commit()
    subprocess.run(export_command(first, last, out), cwd=VENDOR / "backend",
                   env={**_clean_env(), "PYTHONPATH": str(VENDOR / "backend")},
                   check=True)
    manifest = {
        "source": "Missalemeum",
        "url": "https://github.com/mmolenda/missalemeum",
        "licence": "MIT",
        "commit": commit,
        "rubrics": "1962",
        "years": [first, last],
    }
    (out / "source.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def _clean_env() -> dict[str, str]:
    import os
    return {k: v for k, v in os.environ.items() if k not in ("VIRTUAL_ENV", "PYTHONPATH")}


def load_vocabulary(path: Path = CALENDAR_DIR / "days.json") -> dict[str, dict[str, object]]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_year(year: int, directory: Path = CALENDAR_DIR) -> dict[str, dict[str, list[str]]]:
    path = directory / f"{year}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"no calendar for {year}. Generated range is in {directory / 'source.json'}; "
            f"extend it with `uv run noh calendar --from {year} --to {year}`."
        )
    return json.loads(path.read_text(encoding="utf-8"))["days"]
