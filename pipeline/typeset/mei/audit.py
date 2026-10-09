"""Catalogue audit: a text scan of the LilyPond sources, no LilyPond run.

Everything here is a *candidate* signal only. Feature counts come from regexes
over the source text (comments masked), so a count says "this file probably
uses the feature", never "the encoder will cope with it". The extractor (A2)
and the validators are the authority.

Paths. ``root`` is the directory holding the ``.ly`` sources (data/typeset/src).
``SourceRecord.path`` is a POSIX path relative to ``root`` (the keys parts.yml
and manifest.json use for ``file``). ``SourceLocation.filename`` is repo-relative
(``data/typeset/src/...``); the repo root is ``include_dir.resolve().parents[2]``.

Dependency digest. ``render.source_hash(text, include_dir)``, unchanged: it
covers the render version, the LilyPond pin, the house settings, the formats,
the source text and every ``*.ily`` in ``include_dir``.

Unknown commands. Each ``\\name`` token (comments and strings masked) is
unknown unless it is
  * defined in the file itself or in an include file (``name = ...`` at the
    start of a line, which also covers ``name = #(define-music-function ...)``), or
  * in BUILTIN_COMMANDS below: the LilyPond/gregorian.ly commands that actually
    appear across the 859-file corpus (assembled by scanning it), plus a few
    near neighbours. Extend it deliberately when the audit reports a real
    built-in; a genuinely new command should stay visible.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from pipeline.typeset.importer import INCLUDES
from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import (
    FEATURE_FAMILIES,
    PILOT_FIXTURES,
    AuditClass,
    AuditReport,
    SourceRecord,
)
from pipeline.typeset.render import source_hash
from pipeline.typeset.source_check import LILYPOND_INCLUDES

#: LilyPond built-ins seen in the corpus, plus common neighbours. Not an
#: exhaustive LilyPond vocabulary.
BUILTIN_COMMANDS: frozenset[str] = frozenset({
    # structure
    "version", "include", "header", "paper", "layout", "midi", "score", "context", "new", "relative",
    "lyricmode", "lyricsto", "markup", "tempo", "key", "clef", "bar", "break", "change", "set", "unset",
    "override", "revert", "once", "tweak", "if", "unless", "hide", "omit", "remove", "with", "time",
    "partial", "repeat", "grace", "afterGrace", "tag", "keepWithTag", "removeWithTag",
    # music
    "cadenzaOn", "cadenzaOff", "voiceOne", "voiceTwo", "voiceThree", "voiceFour", "oneVoice",
    "tieDown", "tieUp", "tieNeutral", "slurUp", "slurDown", "slurNeutral", "glissando", "prall",
    "parenthesize", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "major", "minor",
    "ionian",
    # markup
    "center-column", "line", "fill-line", "vspace", "fromproperty", "on-first-page",
    "should-print-page-number", "tiny", "teeny", "small", "normalsize", "large", "bold", "italic",
    "normal", "column", "concat", "justify", "wordwrap", "fontsize", "musicglyph",
})

_DEFINITION = re.compile(r"(?m)^[ \t]*([A-Za-z][A-Za-z-]*)[ \t]*=")
_COMMAND = re.compile(r"\\([A-Za-z][A-Za-z-]*)")
_INCLUDE = re.compile(r'\\include\s+"([^"]*)"')
_VOICES = re.compile(r"\\new\s+Voice(?![A-Za-z])")
_STAVES = re.compile(r"\\new\s+Staff(?![A-Za-z])")

_E = r"(?![A-Za-z-])"
#: family -> patterns over comment-masked text. See the A1b card for the table;
#: the real command names (finalis, doubleBar, ...) were checked against noh2.ily.
FEATURE_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    family: tuple(re.compile(p) for p in pats) for family, pats in {
        "voice-line-glissando": (r'\\voiceLine\s+"',),
        "voice-line-voice": (rf"\\voiceLines{_E}",),
        "quilisma": (rf"\\quil{_E}",),
        "divisio-minima": (rf"\\divisioMinima{_E}", rf"\\quarterBar{_E}"),
        "divisio-maior": (rf"\\divisioMaior{_E}", rf"\\halfBar{_E}"),
        "divisio-maxima": (rf"\\divisioMaxima{_E}", rf"\\singleBar{_E}"),
        "finalis": (rf"\\finalis{_E}", rf"\\doubleBar{_E}"),
        "stanza-marker": (r"\\set\s+stanza" + _E,),
        "force-break": (rf"\\forceBreak{_E}", rf"\\break{_E}"),
        "cross-staff": (r"\\change\s+Staff" + _E,),
        "hidden-stem": (r"\\hide\s+Stem" + _E, rf"\\stemsOff{_E}"),
    }.items()
}
assert set(FEATURE_PATTERNS) <= set(FEATURE_FAMILIES)


def mask(text: str, strings: bool = False) -> str:
    """The text with comments (and optionally string contents) blanked to spaces.
    Newlines and every other offset are preserved, so line/column stay true."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "%" and text.startswith("%{", i):
            end = text.find("%}", i + 2)
            end = n if end < 0 else end + 2
            out.append("".join(c if c == "\n" else " " for c in text[i:end]))
            i = end
        elif ch == "%":
            end = text.find("\n", i)
            end = n if end < 0 else end
            out.append(" " * (end - i))
            i = end
        elif ch == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            j = min(j + 1, n)
            chunk = text[i:j]
            out.append(chunk if not strings else '"' + "".join(c if c == "\n" else " " for c in chunk[1:-1]) + '"'
                       if len(chunk) >= 2 else chunk)
            i = j
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _repo_relative(path: Path, repo: Path, fallback: str) -> str:
    try:
        return path.resolve().relative_to(repo).as_posix()
    except ValueError:
        return fallback


def _location(text: str, offset: int, filename: str) -> SourceLocation:
    line = text.count("\n", 0, offset) + 1
    column = offset - (text.rfind("\n", 0, offset) + 1) + 1
    return SourceLocation(filename=filename, line=line, column=column)


def _defined(text: str) -> set[str]:
    return set(_DEFINITION.findall(mask(text, strings=True)))


def _trusted(name: str, include_dir: Path) -> bool:
    if name in LILYPOND_INCLUDES:
        return True
    return (name in INCLUDES and "/" not in name and "\\" not in name
            and (include_dir / name).is_file())


def _read_manifest(include_dir: Path) -> dict[str, str]:
    path = include_dir.parent / "manifest.json"
    if not path.is_file():
        return {}
    doc: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return {str(p["file"]): str(p["target"]) for p in doc.get("parts", []) if "file" in p and "target" in p}


def audit_sources(root: Path, targets: list[dict[str, Any]], include_dir: Path) -> AuditReport:
    """Scan every ``*.ly`` under ``root``. ``targets`` are parts.yml entries
    (``file``, ``target``, ``status``). Never runs LilyPond."""
    repo = include_dir.resolve().parents[2]
    by_file = {str(t["file"]): t for t in targets if "file" in t}
    manifest = _read_manifest(include_dir)
    include_defs: set[str] = set()
    for ily in sorted(include_dir.glob("*.ily")):
        include_defs |= _defined(ily.read_text(encoding="utf-8"))

    records: list[SourceRecord] = []
    family_counts: Counter[str] = Counter()
    unknown_total: Counter[str] = Counter()
    present: set[str] = set()
    for path in sorted(root.rglob("*.ly")):
        rel = path.relative_to(root).as_posix()
        present.add(rel)
        text = path.read_text(encoding="utf-8")
        no_comments = mask(text)
        no_strings = mask(text, strings=True)

        diagnostics: list[Diagnostic] = []
        includes: list[str] = []
        for m in _INCLUDE.finditer(no_comments):
            name = m.group(1)
            includes.append(name)
            if not _trusted(name, include_dir):
                diagnostics.append(Diagnostic(
                    code="UNKNOWN_INCLUDE", severity="error",
                    message=f'\\include "{name}" is not a trusted include file',
                    source_location=_location(text, m.start(), _repo_relative(path, repo, rel)),
                    details=(("include", name),),
                ))

        features: dict[str, int] = {}
        for family, patterns in FEATURE_PATTERNS.items():
            count = sum(len(p.findall(no_comments)) for p in patterns)
            if count:
                features[family] = count
                family_counts[family] += count

        known = BUILTIN_COMMANDS | include_defs | _defined(text)
        unknown = Counter(name for name in _COMMAND.findall(no_strings) if name not in known)
        unknown_total.update(unknown)
        classification: AuditClass = "unknown-feature" if unknown else "candidate"
        for name, count in sorted(unknown.items()):
            diagnostics.append(Diagnostic(
                code="UNKNOWN_FEATURE", severity="warning",
                message=f"\\{name} is not a known LilyPond built-in or defined command ({count} uses)",
                details=(("command", name), ("count", str(count))),
            ))

        entry = by_file.get(rel, {})
        target = entry.get("target") or manifest.get(rel)
        status = entry.get("status")
        records.append(SourceRecord(
            path=rel,
            dependency_digest=source_hash(text, include_dir),
            includes=tuple(includes),
            target=str(target) if target else None,
            match_status=str(status) if status else None,
            voices=len(_VOICES.findall(no_comments)),
            staves=len(_STAVES.findall(no_comments)),
            features=features,
            classification=classification,
            diagnostics=tuple(diagnostics),
        ))

    absent = sorted({str(t["target"]) for t in targets if t.get("file") and t.get("target")
                     and str(t["file"]) not in present})
    return AuditReport(
        sources=tuple(records),
        absent_targets=tuple(absent),
        family_counts=dict(sorted(family_counts.items())),
        unknown_commands=dict(sorted(unknown_total.items(), key=lambda kv: (-kv[1], kv[0]))),
        proposed_pilot=PILOT_FIXTURES,
    )
