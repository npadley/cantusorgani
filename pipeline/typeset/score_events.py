"""Expected all-voice events, extracted by the pinned LilyPond, not text parsing."""
from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

from pipeline.typeset import events, lilypond
from pipeline.typeset.importer import INCLUDES
from pipeline.typeset.source_check import check_file

VOICES = ("chant", "alto", "tenor", "bass")


@dataclass
class MusicalEvent:
    voice: str
    kind: str
    onset: Fraction
    duration: Fraction
    step: int | None = None
    alteration: Fraction | None = None
    origin: str = ""
    written: tuple[int, int, str] | None = None
    tie_in: bool = False
    tie_out: bool = False
    box: tuple[int, int, int, int] | None = None
    system: str = ""


@dataclass
class ScoreEvidence:
    events: list[MusicalEvent] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    context: list[list[str]] = field(default_factory=list)


def instrument_voices(text: str) -> str:
    """Name anonymous voices bound to explicit NOH music variables.

    Unknown contexts remain unidentified and prevent acceptance. No pitch-based
    voice inference; the temporary wrapper leaves the original source untouched.
    """
    pattern = re.compile(r'\\new\s+Voice(?:\s*=\s*"[^"]*")?\s*\{')
    edits = []
    for match in pattern.finditer(text):
        depth, end = 1, match.end()
        while end < len(text) and depth:
            depth += (text[end] == "{") - (text[end] == "}")
            end += 1
        body = re.sub(r"%[^\n]*", "", text[match.end():end - 1])
        bound = [v for v in VOICES if re.search(rf"\\{v}Music\b", body)]
        if len(bound) == 1:
            edits.append((match.start(), match.end(), f'\\new Voice = "{bound[0]}" {{'))
    for start, end, replacement in reversed(edits):
        text = text[:start] + replacement + text[end:]
    return text


def parse_score(tsv: str) -> ScoreEvidence:
    result = ScoreEvidence()
    rows = []
    for line in tsv.splitlines():
        try:
            row = line.split("\t")
            if len(row) < 3:
                raise ValueError("short event")
            rows.append((Fraction(row[0]), row))
        except (ValueError, ZeroDivisionError):
            result.flags.append("malformed event log")
    last: dict[str, MusicalEvent] = {}
    pending: dict[str, MusicalEvent] = {}
    for onset, row in sorted(rows, key=lambda item: item[0]):
        voice, kind = row[1].rsplit(":", 1)[-1], row[2]
        try:
            if kind in ("key", "clef"):
                result.context.append(row)
            if kind not in ("note", "rest", "skip", "tie"):
                continue
            if voice not in VOICES:
                if kind != "skip":
                    result.flags.append(f"unidentified musical voice {row[1]}")
                continue
            if kind == "tie":
                previous = last.get(voice)
                if previous is None or previous.onset != onset or previous.kind != "note":
                    result.flags.append(f"unanchored tie in {voice}")
                else:
                    previous.tie_out = True
                    pending[voice] = previous
                continue
            if kind == "note":
                e = MusicalEvent(voice, kind, onset, Fraction(row[9]),
                                 int(row[5]) * 7 + int(row[3]), Fraction(row[4]),
                                 row[10] if len(row) > 10 else "",
                                 (int(row[6]), int(row[7]), row[8]))
            else:
                e = MusicalEvent(voice, kind, onset, Fraction(row[3]))
            if onset < 0 or e.duration <= 0:
                raise ValueError("invalid timing")
            previous = last.get(voice)
            if previous and previous.onset + previous.duration > onset:
                result.flags.append(f"overlapping events in {voice}")
            if voice in pending:
                tied = pending.pop(voice)
                if (kind != "note" or tied.onset + tied.duration != onset
                        or (tied.step, tied.alteration) != (e.step, e.alteration)):
                    result.flags.append(f"invalid tie in {voice}")
                else:
                    e.tie_in = True
            result.events.append(e)
            last[voice] = e
        except (ValueError, IndexError, ZeroDivisionError):
            result.flags.append("malformed musical event")
    if pending:
        result.flags.append("unfinished tie")
    if not any(e.kind == "note" for e in result.events):
        result.flags.append("no musical notes")
    result.flags = list(dict.fromkeys(result.flags))
    return result


def read_score(path: Path) -> ScoreEvidence:
    problems = check_file(path, INCLUDES)
    if problems:
        return ScoreEvidence(flags=[str(p) for p in problems])
    text = instrument_voices(path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        wrapper = directory / "source.ly"
        wrapper.write_text(events.with_listener(text), encoding="utf-8")
        try:
            run = lilypond.run(["-dno-print-pages", "-o", str(directory / "out"),
                               str(wrapper)], directory,
                              includes=(lilypond.INCLUDE, events.LISTEN_DIR))
        except lilypond.LilyPondError as exc:
            return ScoreEvidence(flags=[str(exc)])
        log = directory / "out.events.tsv"
        if not run.ok or not log.exists():
            return ScoreEvidence(flags=[events.first_error(run.log)])
        result = parse_score(log.read_text(encoding="utf-8"))
        # with_listener inserts one line; voice names add no lines.
        for e in result.events:
            if re.fullmatch(r"\d+:\d+", e.origin):
                line, column = e.origin.split(":")
                e.origin = f"{max(1, int(line) - 1)}:{column}"
        return result
