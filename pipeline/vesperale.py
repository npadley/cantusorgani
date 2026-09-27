"""jsrjenkins/vesperale's Sunday Vespers table, vendored as a cross-check.

vesperale (https://github.com/jsrjenkins/vesperale) builds 1962 Sunday Vespers
booklets. Its `calendar.sty` is a hand-made table by season and Sunday: each
psalm's antiphon and tone, and each Sunday's Magnificat antiphon and tone.
`noh vesperale-fetch` reads that table (a strict reader of its `{key}{\\cmd{a}{b}}`
cases -- nothing is executed) and writes data/vesperale-lineup.json at a pinned
commit, with a content sha256; a hand edit fails the check.

NOH8's own margin labels decide the tone the organist plays; this table only
confirms them. Where the two disagree, `noh vespers-lineup` queues a
`tone_disagreement` (vesperale lists Pent XVI's and XVII's antiphons under
Epiphany V and VI, for instance).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from pipeline.volumes import DATA

REPO = "jsrjenkins/vesperale"
SOURCE_PATH = "calendar.sty"
PINNED = "98edf0e972af3d07e5732f8a223df8786a2a8746"
VENDORED = DATA / "vesperale-lineup.json"

# vesperale's season names and the calendar keys they cover.
SEASONS = {"adventus": "Adv", "epiphania": "Epi", "septuagesima": "Quadp", "quadragesima": "Quad",
           "passio": "Quad", "pentecostes": "Pent"}
_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
          "xi": 11, "xii": 12, "xiii": 13, "xiv": 14, "xv": 15, "xvi": 16, "xvii": 17, "xviii": 18,
          "xix": 19, "xx": 20, "xxi": 21, "xxii": 22, "xxiii": 23, "xxiv": 24}


class VesperaleIntegrityError(RuntimeError):
    """The vendored table is missing or was edited by hand."""


def _block(sty: str, command: str) -> str:
    """The body of `\\newcommand{\\<command>}...` up to the next \\newcommand."""
    start = re.search(r"\\newcommand\{?\\" + command + r"\b", sty)
    if start is None:
        raise VesperaleIntegrityError(f"calendar.sty has no \\{command} table")
    end = sty.find("\\newcommand", start.end())
    return sty[start.end(): end if end >= 0 else len(sty)]


def _strip_comments(tex: str) -> str:
    return "\n".join(re.sub(r"(?<!\\)%.*", "", line) for line in tex.splitlines())


def calendar_key(season: str, sunday: str) -> str | None:
    """The site's calendar key for vesperale's (season, Sunday): ("pentecostes",
    "xiv") -> "tempora:Pent14-0". Septuagesima's three are Quadp1-3; Passion
    Sunday is Quad5."""
    n = _ROMAN.get(sunday)
    stem = SEASONS.get(season)
    if n is None or stem is None:
        return None
    if season == "passio":
        n += 4
    return f"tempora:{stem}{n:02d}-0" if stem == "Pent" else f"tempora:{stem}{n}-0"


def parse_magnificat(sty: str) -> dict[str, dict[str, str]]:
    """{calendar key: {"antiphon": GregoBase-style file name, "tone": "1g"}} from
    the \\canticum table. Entries left empty in the source are skipped."""
    body = _strip_comments(_block(sty, "canticum"))
    out: dict[str, dict[str, str]] = {}
    # Each season: {season}{\IfEqCase{#3}{ ... }}
    for season in SEASONS:
        m = re.search(r"\{" + season + r"\}\{\\IfEqCase\{#3\}\{", body)
        if m is None:
            continue
        depth, i = 1, m.end()
        while i < len(body) and depth:
            depth += {"{": 1, "}": -1}.get(body[i], 0)
            i += 1
        cases = body[m.end(): i]
        for sunday, antiphon, tone in re.findall(
                r"\{([ivx]+)\}\s*\{#1\{([^{}]*)\}\{([^{}]*)\}\}", cases):
            key = calendar_key(season, sunday)
            if key and antiphon and tone:
                out[key] = {"antiphon": antiphon, "tone": tone}
    return out


def _content_sha(table: dict[str, dict[str, str]]) -> str:
    canonical = json.dumps(table, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def write_vendored(table: dict[str, dict[str, str]], commit: str, source_sha256: str,
                   path: Path = VENDORED) -> Path:
    doc = {
        "source": {"repo": f"https://github.com/{REPO}", "path": SOURCE_PATH, "commit": commit,
                   "source_sha256": source_sha256,
                   "refresh": "uv run noh vesperale-fetch [--commit SHA]; do not hand-edit"},
        "content_sha256": _content_sha(table),
        "magnificat": table,
    }
    path.write_text(json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    return path


def load_magnificat(path: Path = VENDORED) -> dict[str, dict[str, str]]:
    if not path.exists():
        raise VesperaleIntegrityError(
            f"{path} is missing -- run uv run noh vesperale-fetch to vendor it.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    table: dict[str, dict[str, str]] = doc["magnificat"]
    actual, recorded = _content_sha(table), doc.get("content_sha256")
    if actual != recorded:
        raise VesperaleIntegrityError(
            f"{path.name} sha256 {actual[:12]} does not match its header {str(recorded)[:12]} "
            f"-- re-run uv run noh vesperale-fetch; do not hand-edit.")
    return table


def fetch(commit: str = PINNED, path: Path = VENDORED) -> tuple[Path, str, int]:
    """Download calendar.sty at `commit`, parse it and vendor the table. Leaves
    `path` untouched on any failure."""
    import urllib.request

    if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        raise VesperaleIntegrityError(f"not a commit sha: {commit!r}")
    url = f"https://raw.githubusercontent.com/{REPO}/{commit}/{SOURCE_PATH}"
    request = urllib.request.Request(url, headers={"User-Agent": "cantusorgani-pipeline"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw: bytes = response.read()
    table = parse_magnificat(raw.decode("utf-8"))      # raises before any write
    if not table:
        raise VesperaleIntegrityError("calendar.sty's \\canticum table yielded no Sundays")
    write_vendored(table, commit, hashlib.sha256(raw).hexdigest(), path)
    return path, commit, len(table)


def tone_of(vesperale_tone: str) -> str | None:
    """vesperale's tone file suffix in NOH's notation: "1g" -> "I.g", "8Gstar" ->
    "VIII.G*", "1D2" -> "I.D2", "req-7c" -> None (not a Sunday tone)."""
    m = re.fullmatch(r"([1-8])([A-Za-z]?)(\d?)(star)?", vesperale_tone)
    if m is None:
        return None
    roman = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII")[int(m.group(1)) - 1]
    ending = m.group(2)
    return roman + (f".{ending}{m.group(3)}" if ending else "") + ("*" if m.group(4) else "")


__all__ = ["PINNED", "VENDORED", "VesperaleIntegrityError", "calendar_key", "fetch",
           "load_magnificat", "parse_magnificat", "tone_of", "write_vendored"]
