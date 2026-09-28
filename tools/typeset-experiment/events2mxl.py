"""Experiment: LilyPond's own event log (listen.ily) -> MusicXML, for one NOH file.

Usage: events2mxl.py <events.tsv> <source.ly> <out.musicxml>
"""
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from xml.sax.saxutils import escape

STEPS = "CDEFGAB"
# Which LilyPond voice is which NOH voice, and where it sits.
VOICES = {"up:chant": (1, 1, "chant"), "up:1": (1, 2, "alto"), "down:2": (2, 3, "tenor"), "down:3": (2, 4, "bass")}
BARS = {"finalis": "light-light", "divisioMinima": "tick", "divisioMaior": "short", "divisioMaxima": "regular"}
SPACERS = "--spacers" in sys.argv
TYPES = {0: "whole", 1: "half", 2: "quarter", 3: "eighth", 4: "16th"}


@dataclass
class Note:
    start: Fraction
    length: Fraction
    pitch: tuple[int, int, int] | None          # notename, alter (halves), octave; None = spacer
    log: int = 2
    dots: int = 0
    tie_next: bool = False
    slur: list[int] = field(default_factory=list)  # -1 start, 1 stop
    lyric: tuple[str, str, str] | None = None     # text, syllabic, stanza


def parse(tsv: str, source: str) -> tuple[dict[str, list[Note]], list[tuple[Fraction, str]], int]:
    lines = source.splitlines()
    voices: dict[str, list[Note]] = {v: [] for v in VOICES}
    bars: list[tuple[Fraction, str]] = []
    fifths = 0
    lyrics: list[tuple[Fraction, str, str]] = []
    hyphen_after: set[Fraction] = set()
    for raw in tsv.splitlines():
        f = raw.split("\t")
        t, who, kind = Fraction(f[0]), f[1], f[2]
        if kind == "key":
            fifths = int(f[6])
        elif kind == "note":
            n, alt, octv, log, dots = int(f[3]), Fraction(f[4]), int(f[5]), int(f[6]), int(f[7])
            voices[who].append(Note(t, Fraction(f[9]), (n, int(alt * 2), octv), log, dots))
        elif kind in ("skip", "rest"):
            voices[who].append(Note(t, Fraction(f[3]), None))
        elif kind == "tie":
            voices[who][-1].tie_next = True
        elif kind == "slur":
            voices[who][-1].slur.append(int(f[3]))
        elif kind == "breathe" and who == "up:chant":
            line, col = (int(x) for x in f[3].split(":"))
            word = re.match(r"\\(\w+)", lines[line - 1][col:])
            bars.append((t, word.group(1) if word else "divisioMaxima"))
        elif kind == "lyric":
            lyrics.append((t, f[3], f[4] if len(f) > 4 else ""))
        elif kind == "hyphen":
            hyphen_after.add(lyrics[-1][0])
    # Syllables onto the chant notes that start with them; "_" placeholders are melisma.
    chant = {n.start: n for n in voices["up:chant"]}
    open_word = False
    for t, text, stanza in lyrics:
        if not text.strip():
            continue
        cont = t in hyphen_after
        syllabic = ("middle" if cont else "end") if open_word else ("begin" if cont else "single")
        open_word = cont
        if t in chant:
            chant[t].lyric = (text, syllabic, stanza)
    return voices, bars, fifths


def measures(voices: dict[str, list[Note]], bars: list[tuple[Fraction, str]]) -> list[tuple[Fraction, Fraction, str]]:
    end = max(n.start + n.length for v in voices.values() for n in v)
    out, a = [], Fraction(0)
    for t, word in bars:
        if t > a:
            out.append((a, t, word))
            a = t
    if a < end:
        out.append((a, end, "finalis"))
    return out


def pitch_xml(p: tuple[int, int, int]) -> str:
    n, alt, octv = p
    a = f"<alter>{alt}</alter>" if alt else ""   # LilyPond counts half-steps as 1/2
    return f"<pitch><step>{STEPS[n]}</step>{a}<octave>{octv + 4}</octave></pitch>"


def convert(voices: dict[str, list[Note]], bars: list[tuple[Fraction, str]], fifths: int, title: str) -> str:
    moments = [n.start for v in voices.values() for n in v] + [n.length for v in voices.values() for n in v]
    divisions = math.lcm(*((m * 4).denominator for m in moments))      # per quarter note

    def q(x: Fraction) -> int:                                           # a length in whole notes
        return int(x * 4 * divisions)
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<score-partwise version="4.0">',
           f"<work><work-title>{escape(title)}</work-title></work>",
           '<part-list><score-part id="P1"><part-name>Organ</part-name></score-part></part-list>',
           '<part id="P1">']
    for number, (a, b, word) in enumerate(measures(voices, bars), 1):
        xml.append(f'<measure number="{number}">')
        if number == 1:
            xml.append(f"<attributes><divisions>{divisions}</divisions><key><fifths>{fifths}</fifths></key>"
                       '<time print-object="no"><senza-misura/></time><staves>2</staves>'
                       '<clef number="1"><sign>G</sign><line>2</line></clef>'
                       '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
        first = True
        for name, (staff, voice, _) in VOICES.items():
            if not first:
                xml.append(f"<backup><duration>{q(b - a)}</duration></backup>")
            first = False
            cursor = a
            for n in voices[name]:
                s, e = max(n.start, a), min(n.start + n.length, b)
                if e <= s:
                    continue
                if s > cursor:
                    xml.append(f"<forward><duration>{q(s - cursor)}</duration><voice>{voice}</voice><staff>{staff}</staff></forward>")
                split_before, split_after = n.start < a, n.start + n.length > b
                if n.pitch is None:
                    xml.append(f"<forward><duration>{q(e - s)}</duration><voice>{voice}</voice><staff>{staff}</staff></forward>")
                    cursor = e
                    continue
                ties = []
                if split_before or (n is not voices[name][0] and _tied_from_previous(voices[name], n)):
                    ties.append("stop")
                if split_after or n.tie_next:
                    ties.append("start")
                # A held note is drawn as its written value; the rest of its length is
                # invisible space, so Verovio (which spaces by the written value) keeps
                # the next note under the chant note it sounds with.
                written = Fraction(1, 2 ** n.log) * (2 - Fraction(1, 2 ** n.dots))
                drawn = min(e - s, written) if SPACERS and name != "up:chant" else e - s
                parts = [pitch_xml(n.pitch), f"<duration>{q(drawn)}</duration>"]
                parts += [f'<tie type="{t}"/>' for t in ties]
                parts += [f"<voice>{voice}</voice>", f"<type>{TYPES.get(n.log, 'quarter')}</type>"]
                parts += ["<dot/>"] * n.dots
                parts += ["<stem>none</stem>", f"<staff>{staff}</staff>"]
                notations = [f'<tied type="{t}"/>' for t in ties]
                notations += [f'<slur type="{"start" if d < 0 else "stop"}" number="1"/>' for d in n.slur if not split_before]
                if notations:
                    parts.append(f"<notations>{''.join(notations)}</notations>")
                if n.lyric and not split_before:
                    text, syllabic, stanza = n.lyric
                    shown = f"{stanza} {text}" if stanza else text
                    parts.append(f'<lyric number="1" placement="above"><syllabic>{syllabic}</syllabic>'
                                 f"<text>{escape(shown)}</text></lyric>")
                xml.append(f"<note>{''.join(parts)}</note>")
                if drawn < e - s:
                    xml.append(f"<forward><duration>{q(e - s - drawn)}</duration><voice>{voice}</voice><staff>{staff}</staff></forward>")
                cursor = e
            if cursor < b:
                xml.append(f"<forward><duration>{q(b - cursor)}</duration><voice>{voice}</voice><staff>{staff}</staff></forward>")
        style = "light-heavy" if b == measures(voices, bars)[-1][1] else BARS.get(word, "regular")
        xml.append(f'<barline location="right"><bar-style>{style}</bar-style></barline></measure>')
    xml += ["</part>", "</score-partwise>"]
    return "\n".join(xml)


def _tied_from_previous(notes: list[Note], n: Note) -> bool:
    i = notes.index(n)
    return i > 0 and notes[i - 1].tie_next and notes[i - 1].pitch == n.pitch


if __name__ == "__main__":
    tsv, src, out = sys.argv[1:4]
    voices, bars, fifths = parse(Path(tsv).read_text(encoding="utf-8"), Path(src).read_text(encoding="utf-8"))
    Path(out).write_text(convert(voices, bars, fifths, "Kyrie IX"), encoding="utf-8")
    print(f"{sum(len([n for n in v if n.pitch]) for v in voices.values())} notes, {len(measures(voices, bars))} phrases")
