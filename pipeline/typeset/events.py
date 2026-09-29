"""What a transcription contains, read from LilyPond itself: every note of the
chant voice and the words sung, via the event logger (pipeline/typeset/listen.ily,
our own and trusted: it writes the log, so it is never a source's include).

Reading LilyPond's own events rather than parsing the .ly text means whatever
LilyPond would engrave is what is compared (the Kyrie IX experiment: 290 of 290
notes identical to LilyPond's MIDI). Results are cached in build/typeset/events/
by the hash of everything that decides them, so a second run is instant.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from pipeline.typeset import lilypond
from pipeline.typeset.lilypond import INCLUDE

LISTEN_DIR = Path(__file__).parent
LISTEN = LISTEN_DIR / "listen.ily"
CACHE = lilypond.ROOT / "build" / "typeset" / "events"
_NOH2 = re.compile(r'^(\s*\\include\s+"noh2\.ily".*)$', re.MULTILINE)
_VERSION = re.compile(r'^(\s*\\version\s+"[^"]*".*)$', re.MULTILINE)


@dataclass(frozen=True)
class Events:
    """One file as LilyPond read it: the chant voice's notes (as diatonic steps
    from middle C, ties joined), its words, and LilyPond's complaint if it failed."""
    ok: bool
    steps: tuple[int, ...]
    words: tuple[str, ...]
    error: str | None = None

    @property
    def incipit(self) -> str:
        return " ".join(self.words[:8])


def with_listener(text: str) -> str:
    """The source with the event logger included after the house style."""
    line = '\\include "listen.ily"'
    for pattern in (_NOH2, _VERSION):
        if pattern.search(text):
            return pattern.sub(lambda m: f"{m.group(1)}\n{line}", text, count=1)
    return f"{line}\n{text}"


def cache_key(text: str, version: str, include: Path = INCLUDE) -> str:
    h = hashlib.sha256()
    for part in (text, LISTEN.read_text(encoding="utf-8"), version,
                 *(p.read_text(encoding="utf-8") for p in sorted(include.glob("*.ily")))):
        h.update(part.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def parse(tsv: str) -> tuple[tuple[int, ...], tuple[str, ...]]:
    """The chant voice's steps (a tied note held over is one note) and the words."""
    steps: list[int] = []
    syllables: list[str] = []
    held: set[str] = set()
    last_voice_note: dict[str, int] = {}
    rows = [r.split("\t") for r in tsv.splitlines() if r]
    rows.sort(key=lambda r: Fraction(r[0]))            # stable: same-moment events keep their order
    for r in rows:
        voice, kind = r[1], r[2]
        if kind == "note" and voice.endswith(":chant"):
            if voice in held:
                held.discard(voice)
                continue
            step = int(r[5]) * 7 + int(r[3])
            steps.append(step)
            last_voice_note[voice] = step
        elif kind == "tie" and voice.endswith(":chant"):
            held.add(voice)
        elif kind == "lyric":
            syllables.append(r[3])
        elif kind == "hyphen" and syllables:
            syllables[-1] += "-"
    words = " ".join(syllables).replace("- ", "").split()
    return tuple(steps), tuple(w.strip(".,;:*") for w in words if w.strip(".,;:*"))


def read(path: Path, cache: Path = CACHE, include: Path = INCLUDE) -> Events:
    """The events of one source file (which must already pass the source check)."""
    text = path.read_text(encoding="utf-8")
    version = lilypond.load_pin().version
    key = cache_key(text, version, include)
    hit = cache / f"{key}.tsv"
    miss = cache / f"{key}.error"
    if hit.exists():
        return Events(True, *parse(hit.read_text(encoding="utf-8")))
    if miss.exists():
        return Events(False, (), (), miss.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        wrapper = Path(tmp) / "source.ly"
        wrapper.write_text(with_listener(text), encoding="utf-8")
        result = lilypond.run(["-dno-print-pages", "-o", str(Path(tmp) / "out"), str(wrapper)], cwd=Path(tmp),
                              includes=(include, LISTEN_DIR))
        ok, log = result.ok, result.log
        produced = Path(tmp) / "out.events.tsv"
        cache.mkdir(parents=True, exist_ok=True)
        if ok and produced.exists():
            shutil.copyfile(produced, hit)
            return Events(True, *parse(hit.read_text(encoding="utf-8")))
        error = first_error(log)
        miss.write_text(error, encoding="utf-8")
        return Events(False, (), (), error)


def first_error(log: str) -> str:
    """LilyPond's first error line, with the line number in the source (the
    wrapper adds one line after the house-style include; that is allowed for)."""
    for line in log.splitlines():
        if "error" in line.lower():
            return re.sub(r"^.*?source\.ly:", "line ", line).strip()
    return (log.strip().splitlines() or ["LilyPond failed"])[-1]


def read_all(paths: list[Path], workers: int = 4) -> dict[Path, Events]:
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(zip(paths, pool.map(read, paths), strict=True))


__all__ = ["CACHE", "Events", "cache_key", "first_error", "parse", "read", "read_all", "with_listener"]
