"""Divinum Officium's Vespers texts (1960 rubrics), vendored.

Divinum Officium (https://github.com/DivinumOfficium/divinum-officium, MIT)
keeps each day's office as a text file of named sections: `[Ant Vespera]`
holds the psalm antiphons, one per line, each ending `;;<psalm number>`;
`[Ant 1]` and `[Ant 3]` the Magnificat antiphons of I and II Vespers;
`[Hymnus Vespera]`, `[Versum 1]`, `[Capitulum Vespera]` the rest. A line
`@Tempora/Pent01-1` or `@:Ant Laudes` borrows a section; `[Rule]`'s `ex C11`
names the Common the rest comes from; a section or a line may hold only under
some rubrics ("(sed rubrica cisterciensis)", "[Rank] (rubrica 1960)").

`noh officium-fetch` downloads the files the Vespers lineup needs at a pinned
commit, resolves those sections for the 1960 rubrics (a strict reader --
nothing is executed) and writes data/vespers/divinum-officium-vespers.json with a
content sha256. The site uses these texts only as words: which antiphon, which
psalm, the chapter; NOH8 is the music.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from pipeline.volumes import VESPERS

REPO = "DivinumOfficium/divinum-officium"
BASE = "web/www/horas/Latin"
PINNED = "5cf0e7f0a3f2c8e1567e0bb0fef2e662250125a0"
VENDORED = VESPERS / "divinum-officium-vespers.json"

# The offices the lineup reads, by Divinum Officium file (Tempora/..., Sancti/...).
OFFICES = (
    [f"Tempora/Adv{n}-0" for n in range(1, 5)]
    + ["Tempora/Nat1-0", "Tempora/Nat2-0", "Tempora/Epi1-0"]
    + [f"Tempora/Epi{n}-0" for n in range(2, 7)]
    + [f"Tempora/Quadp{n}-0" for n in range(1, 4)]
    + [f"Tempora/Quad{n}-0" for n in range(1, 7)]
    + [f"Tempora/Pasc{n}-0" for n in range(8)]
    + ["Tempora/Pasc5-4", "Tempora/Pent01-0", "Tempora/Pent01-4", "Tempora/Pent02-5"]
    + [f"Tempora/Pent{n:02d}-0" for n in range(2, 25)]
    + [f"Sancti/{d}" for d in ("12-25", "01-01", "01-06", "02-02", "03-19", "03-25", "06-24", "06-29",
                                "07-01", "08-15", "10-DU", "11-01", "12-08", "11-09")]
)
PSALTER = "Psalterium/Psalmi/Psalmi major"


class OfficiumError(RuntimeError):
    """The vendored texts are missing or edited, or a source file cannot be read."""


# ------------------------------------------------------------------ parsing ---

_HEADER = re.compile(r"^\[([^\]]+)\]\s*(?:\((.+)\))?\s*$")


def parse_sections(text: str) -> dict[str, list[tuple[str | None, list[str]]]]:
    """{section name: [(condition or None, lines)]} in file order."""
    out: dict[str, list[tuple[str | None, list[str]]]] = {}
    current: list[str] | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        m = _HEADER.match(line)
        if m:
            current = []
            out.setdefault(m.group(1).strip(), []).append((m.group(2), current))
        elif current is not None:
            current.append(line)
    return out


def applies_1960(condition: str | None) -> bool:
    """Whether a rubric condition holds under the 1960 rubrics. "rubrica 1960"
    and "rubrica 196" hold; "nisi rubrica 1960" does not; a condition naming
    only other uses (cisterciensis, praedicatorum, monastica, tridentina,
    divino) does not; "nisi rubrica cisterciensis" does."""
    if condition is None:
        return True
    c = condition.lower()
    names_1960 = "196" in c or "innovata" in c
    if c.strip().startswith("nisi") or " nisi " in f" {c} ":
        return not names_1960
    return names_1960


def _clean(lines: list[str]) -> list[str]:
    """A section body for 1960: inline "(sed rubrica X)" replaces what came
    before when X holds, and ends the body when it does not."""
    kept: list[str] = []
    for line in lines:
        m = re.fullmatch(r"\s*\((?:sed\s+)?(rubrica[^)]*|communi[^)]*|nisi[^)]*)\)\s*", line)
        if m:
            if applies_1960(m.group(1)):
                kept = []
                continue
            break
        kept.append(line)
    return [ln for ln in kept if ln.strip()]


class Library:
    """Divinum Officium files by name ("Sancti/12-25"), resolved for 1960."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = {name: parse_sections(text) for name, text in files.items()}

    def rule(self, name: str) -> list[str]:
        return self._pick(name, "Rule") or []

    def _pick(self, name: str, section: str) -> list[str] | None:
        variants = self.files.get(name, {}).get(section)
        if not variants:
            return None
        chosen: list[str] | None = None
        for condition, lines in variants:
            if condition is None and chosen is None or condition is not None and applies_1960(condition):
                chosen = lines
        return _clean(chosen) if chosen is not None else None

    def parent(self, name: str) -> str | None:
        for line in self.rule(name):
            m = re.match(r"\s*(?:ex|vide)\s+([A-Za-z]+/[\w-]+|C\d+[a-z]?)\b", line)
            if m:
                target = m.group(1)
                return target if "/" in target else f"Commune/{target}"
        return None

    def section(self, name: str, section: str, depth: int = 0) -> list[str] | None:
        """A section's lines for 1960, following @ references and the Rule's
        parent office or Common."""
        if depth > 8:
            raise OfficiumError(f"{name} [{section}]: references loop")
        lines = self._pick(name, section)
        if lines is None:
            parent = self.parent(name)
            return self.section(parent, section, depth + 1) if parent else None
        out: list[str] = []
        for line in lines:
            m = re.fullmatch(r"@([A-Za-z]+/[\w-]+|C\d+[a-z]?)?(?::([^:]+))?(?::s/.*)?", line.strip())
            if m and (m.group(1) or m.group(2)):
                target = m.group(1) or name
                if target and "/" not in target:
                    target = f"Commune/{target}"
                borrowed = self.section(target, (m.group(2) or section).strip(), depth + 1)
                if borrowed is None:
                    raise OfficiumError(f"{name} [{section}]: reference {line.strip()} not found in the "
                                        f"vendored copy; re-run noh officium-fetch or add {target} to OFFICES")
                out.extend(borrowed)
            else:
                out.append(line)
        return out


def antiphon_lines(lines: list[str] | None) -> list[dict[str, object]]:
    """"Rex pacíficus * magnificátus est ...;;109" -> {text, psalm: 109}."""
    out: list[dict[str, object]] = []
    for line in lines or []:
        text, _, rest = line.partition(";;")
        psalm = re.match(r"\s*(\d+)", rest)
        out.append({"text": text.strip(), "psalm": int(psalm.group(1)) if psalm else None})
    return out


def _first(lines: list[str] | None) -> str | None:
    for line in lines or []:
        text = re.sub(r"\{[^}]*\}", "", line).strip()
        text = re.sub(r"^[vr]\.\s*|^[!$@].*|^/:.*:/$", "", text).strip()
        if text:
            return text
    return None


def office(lib: Library, name: str) -> dict[str, object]:
    """I and II Vespers of one office, for 1960. A key is absent where the
    office has no text of its own (the Sunday psalter applies).

    Of several candidate sections ("Ant Vespera 3", then "Ant Vespera"), the
    office's own file is read first; only then its parent office or Common --
    a feast's own antiphons are not displaced by its Common's II Vespers."""
    def first_of(sections: list[str]) -> list[str] | None:
        chain: list[str] = []
        current: str | None = name
        while current and current not in chain and len(chain) < 8:
            chain.append(current)
            current = lib.parent(current)
        for file in chain:
            for s in sections:
                if lib._pick(file, s) is not None:
                    return lib.section(file, s)
        return None

    def part(ants: list[str], magnificat: str, versicle: list[str], chapter: list[str]) -> dict[str, object]:
        return {
            "antiphons": antiphon_lines(first_of(ants)),
            "magnificat": _first(first_of([magnificat])),
            "versicle": (first_of(versicle) or [])[:2],
            "chapter": _first(first_of(chapter)),
        }
    return {
        "hymn": _first(lib.section(name, "Hymnus Vespera")),
        "I": part(["Ant Vespera"], "Ant 1", ["Versum 1"], ["Capitulum Vespera 1", "Capitulum Vespera"]),
        "II": part(["Ant Vespera 3", "Ant Vespera"], "Ant 3", ["Versum 3", "Versum 1"],
                   ["Capitulum Vespera 3", "Capitulum Vespera", "Capitulum Laudes"]),
    }


def psalm_text(text: str) -> list[str]:
    """A psalm file's verses without their numbers: "109:1a Dixit ..." -> "Dixit ..."."""
    return [re.sub(r"^\d+:\d+[a-z]?\s*", "", ln).strip() for ln in text.splitlines()
            if re.match(r"^\d+:\d+", ln)]


def build(files: dict[str, str]) -> dict[str, object]:
    """The vendored document's content from the raw files."""
    lib = Library(files)
    offices = {name: office(lib, name) for name in OFFICES if name in lib.files}
    sunday = antiphon_lines(lib.section(PSALTER, "Day0 Vespera"))
    numbers = {int(a["psalm"]) for o in offices.values() for v in ("I", "II")        # type: ignore[union-attr]
               for a in o[v]["antiphons"] if a["psalm"]} | {109, 110, 111, 112, 113}  # type: ignore[index]
    psalms = {str(n): psalm_text(files[f"Psalterium/Psalmorum/Psalm{n}"])
              for n in sorted(numbers) if f"Psalterium/Psalmorum/Psalm{n}" in files}
    return {"offices": offices, "sunday": sunday, "psalms": psalms}


def _content_sha(content: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def write_vendored(content: dict[str, object], commit: str, path: Path = VENDORED) -> Path:
    doc = {"source": {"repo": f"https://github.com/{REPO}", "path": BASE, "commit": commit, "licence": "MIT",
                      "refresh": "uv run noh officium-fetch [--commit SHA]; do not hand-edit"},
           "content_sha256": _content_sha(content), **content}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return path


def load(path: Path = VENDORED) -> dict[str, object]:
    if not path.exists():
        raise OfficiumError(f"{path} is missing -- run uv run noh officium-fetch to vendor it.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    content = {k: doc[k] for k in ("offices", "sunday", "psalms")}
    actual = _content_sha(content)
    if actual != doc.get("content_sha256"):
        raise OfficiumError(f"{path.name} sha256 {actual[:12]} does not match its header "
                            f"{str(doc.get('content_sha256'))[:12]} -- re-run uv run noh officium-fetch; "
                            f"do not hand-edit.")
    return content


def needed_files(get: object) -> dict[str, str]:
    """Every file the offices reach: the offices, their parents and Commons, the
    psalter and the psalms. `get(name)` returns a file's text or None."""
    fetch = get  # type: ignore[assignment]
    files: dict[str, str] = {}
    queue = list(OFFICES) + [PSALTER]
    while queue:
        name = queue.pop()
        if name in files:
            continue
        text = fetch(name)     # type: ignore[operator]
        if text is None:
            continue
        files[name] = text
        for m in re.finditer(r"@([A-Za-z]+/[\w-]+)|(?:^|\s)(?:ex|vide)\s+([A-Za-z]+/[\w-]+|C\d+[a-z]?)\b", text):
            target = m.group(1) or m.group(2)
            queue.append(target if "/" in target else f"Commune/{target}")
    numbers = {int(n) for t in files.values() for n in re.findall(r";;(\d+)", t)} | set(range(109, 118))
    for n in sorted(numbers):
        name = f"Psalterium/Psalmorum/Psalm{n}"
        text = fetch(name)     # type: ignore[operator]
        if text is not None:
            files[name] = text
    return files


def fetch(commit: str = PINNED, path: Path = VENDORED) -> tuple[Path, str, int]:
    """Download what the lineup needs at `commit`, resolve it and vendor it.
    Leaves `path` untouched on any failure."""
    import urllib.error
    import urllib.request
    from urllib.parse import quote

    if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        raise OfficiumError(f"not a commit sha: {commit!r}")

    def get(name: str) -> str | None:
        url = f"https://raw.githubusercontent.com/{REPO}/{commit}/{BASE}/{quote(name)}.txt"
        request = urllib.request.Request(url, headers={"User-Agent": "cantusorgani-pipeline"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise

    content = build(needed_files(get))
    if not content["offices"]:
        raise OfficiumError("no offices were read")
    write_vendored(content, commit, path)
    return path, commit, len(content["offices"])     # type: ignore[arg-type]


__all__ = ["OFFICES", "PINNED", "VENDORED", "Library", "OfficiumError", "antiphon_lines", "applies_1960",
           "build", "fetch", "load", "needed_files", "office", "parse_sections", "psalm_text", "write_vendored"]
