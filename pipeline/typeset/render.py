"""Draw each transcription for the site: two SVGs and a PDF, named by a hash.

    narrow.svg   phone width: 90 mm lines, staff 17 (a 24 px staff on a 390 px
                 phone), lines broken to fit
                 (pipeline/typeset/narrow.ily)
    wide.svg     tablet and desktop: 190 mm lines, staff 18, the book's own
                 line breaks, so it can be read against the scan line by line
    letter.pdf   the export: US Letter pages, staff 18, the book's line breaks
    a4.pdf       the same on A4

All four use LilyPond's Cairo backend, which draws text as outlines: no
fonts are needed to show them. pipeline/typeset/render.ily removes titles and
running heads; the page names the part, and the credit goes under the music.

The hash covers everything that decides the drawing: the source, the include
files, the render settings, the LilyPond version and RENDER_VERSION. The same
hash always means the same files, so a render is published once under
typeset/<hash>/ and never overwritten (docs/claudekit/specs/2026-09-28-typesetting-design.md §3).
"""

from __future__ import annotations

import hashlib
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from pipeline.typeset import lilypond
from pipeline.typeset.lilypond import INCLUDE

#: Bump to re-render everything after a change to how rendering works that the
#: files below do not show (a new LilyPond option, say).
RENDER_VERSION = "2"
HERE = Path(__file__).parent
RENDER_ILY = HERE / "render.ily"
NARROW_ILY = HERE / "narrow.ily"
PRELUDE_ILY = HERE / "prelude.ily"
FILES = ("narrow.svg", "wide.svg", "letter.pdf", "a4.pdf")
#: Printed pages keep a printer's margins; the pictures on screen need none.
PRINT_MARGINS = "top-margin = 12\\mm bottom-margin = 12\\mm left-margin = 15\\mm right-margin = 12\\mm"

_NOH2 = re.compile(r'^(\s*\\include\s+"noh2\.ily".*)$', re.MULTILINE)


@dataclass(frozen=True)
class Format:
    name: str
    output: str
    paper: str
    staff: int
    narrow: bool


FORMATS = (
    Format("narrow", "narrow.svg", "paper-width = 90\\mm page-breaking = #ly:one-page-breaking", 17, True),
    Format("wide", "wide.svg", "paper-width = 190\\mm page-breaking = #ly:one-page-breaking", 18, False),
    Format("letter", "letter.pdf", f"#(set-paper-size \"letter\") {PRINT_MARGINS}", 18, False),
    Format("a4", "a4.pdf", f"#(set-paper-size \"a4\") {PRINT_MARGINS}", 18, False),
)
#: Warnings that mean LilyPond itself went wrong: these fail a render. Other
#: warnings are the transcriptions' own small slips (a slur with nothing to
#: attach to, an unfinished lyric hyphen: hundreds in the upstream files) and
#: do not spoil the drawing; they are kept with the render for proofreading.
FATAL_WARNINGS = (re.compile(r"programming error", re.IGNORECASE),)
#: Programming errors LilyPond recovers from with the drawing otherwise whole:
#: a tie that meets a line break is left out ("Tie without heads"), and a
#: spacing column is placed without its neighbour ("Loose column"). Kept as
#: warnings for proofreading, like the transcriptions' own slips.
RECOVERED = (re.compile(r"Tie without heads"), re.compile(r"Loose column does not have right side"))
#: Warnings not worth keeping at all.
IGNORED_WARNINGS = (re.compile(r"gregorian\.ly is deprecated"),)


def settings_text() -> str:
    return "".join(p.read_text(encoding="utf-8") for p in (PRELUDE_ILY, NARROW_ILY, RENDER_ILY))


def source_hash(text: str, include: Path = INCLUDE, version: str | None = None) -> str:
    """The name a render is published under."""
    h = hashlib.sha256()
    formats = repr([(f.name, f.output, f.paper, f.staff, f.narrow) for f in FORMATS])
    parts = [RENDER_VERSION, version or lilypond.load_pin().version, settings_text(), formats, text,
             *(f"{p.name}\n{p.read_text(encoding='utf-8')}" for p in sorted(include.glob("*.ily")))]
    for part in parts:
        h.update(part.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:32]


def wrap(text: str, fmt: Format) -> str:
    """The source with one format's settings: the prelude (and the phone
    layout) right after the house style, before the music uses them; the page
    settings at the end, where they override the file's own."""
    lines = ['\\include "prelude.ily"'] + (['\\include "narrow.ily"'] if fmt.narrow else [])
    block = "\n".join(lines)
    text = _NOH2.sub(lambda m: f"{m.group(1)}\n{block}", text, count=1) if _NOH2.search(text) \
        else f"{block}\n{text}"
    return (f"{text}\n\\include \"render.ily\"\n\\paper {{ {fmt.paper} }}\n"
            f"#(set-global-staff-size {fmt.staff})\n")


def warnings_in(log: str) -> list[str]:
    """LilyPond's warnings, each with its line in the source, less the ignored ones."""
    out = []
    for line in log.splitlines():
        if ("warning:" in line or "programming error" in line) and not any(p.search(line) for p in IGNORED_WARNINGS):
            out.append(re.sub(r"^.*?source\.ly:", "line ", line).strip())
    return out


@dataclass
class Rendered:
    hash: str
    ok: bool
    files: list[Path] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    #: The wide format's warnings (the book's own layout): for proofreading.
    warnings: list[str] = field(default_factory=list)


def render(path: Path, out: Path, include: Path = INCLUDE) -> Rendered:
    """Render one source into out/<hash>/. Nothing is left there unless all
    three files were drawn without an error or an unexpected warning."""
    text = path.read_text(encoding="utf-8")
    digest = source_hash(text, include)
    result = Rendered(digest, False)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for fmt in FORMATS:
            (work / "source.ly").write_text(wrap(text, fmt), encoding="utf-8")
            backend = ["-dbackend=cairo", "--svg" if fmt.output.endswith(".svg") else "--pdf"]
            done = lilypond.run([*backend, "-o", str(work / fmt.name), "source.ly"], cwd=work,
                                includes=(include, HERE))
            produced = work / f"{fmt.name}{Path(fmt.output).suffix}"
            if not done.ok or not produced.exists():
                from pipeline.typeset.events import first_error
                result.problems.append(f"{fmt.name}: {first_error(done.log)}")
                return result
            found = warnings_in(done.log)
            fatal = [w for w in found if any(p.search(w) for p in FATAL_WARNINGS)
                     and not any(p.search(w) for p in RECOVERED)]
            result.problems += [f"{fmt.name}: {w}" for w in fatal]
            result.warnings += [f"{fmt.name}: {w}" for w in found if w not in fatal]
            if fmt.output.endswith(".svg") and _pages(work, fmt.name) > 1:
                result.problems.append(f"{fmt.name}: drew more than one page")
            shutil.move(produced, work / fmt.output)
        if result.problems:
            return result
        dest = out / digest
        dest.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            shutil.copyfile(work / name, dest / name)
            result.files.append(dest / name)
    result.ok = True
    return result


def _pages(work: Path, stem: str) -> int:
    """LilyPond writes page 2 onwards as <stem>-2.svg ..."""
    return 1 + len(list(work.glob(f"{stem}-*.svg")))


__all__ = [
    "FATAL_WARNINGS",
    "FILES",
    "FORMATS",
    "IGNORED_WARNINGS",
    "RECOVERED",
    "RENDER_VERSION",
    "Rendered",
    "render",
    "source_hash",
    "warnings_in",
    "wrap",
]
