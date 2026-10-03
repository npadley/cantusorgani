"""Conservative note-level evidence for proofreading, separate from matching.

A clean comparison covers both complete sequences. Unknown notation, accidental
scope and reconstructed repetitions stay visible; no result acknowledges a score.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from fractions import Fraction

from pipeline.typeset.melody import DOXOLOGY, letters


@dataclass(frozen=True)
class Note:
    step: int
    alteration: Fraction | None = Fraction(0)
    origin: str = ""
    lyric: str = ""
    phrase: int = 0

    @property
    def chromatic(self) -> Fraction | None:
        if self.alteration is None:
            return None
        octave, pitch = divmod(self.step, 7)
        return 12 * octave + (0, 2, 4, 5, 7, 9, 11)[pitch] + 2 * self.alteration


@dataclass(frozen=True)
class NoteSequence:
    notes: tuple[Note, ...]
    flags: tuple[str, ...] = ()
    transformations: tuple[str, ...] = ()


@dataclass(frozen=True)
class Comparison:
    diatonic_equal: bool
    chromatic_equal: bool | None
    transposition: int | None
    opcodes: tuple[tuple[str, int, int, int, int], ...]
    flags: tuple[str, ...] = ()


def _unique(items: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(items))


def read_events(tsv: str, inserted_after: int = 0) -> NoteSequence:
    """Read existing logger TSV; preserve attacks and only join valid ties.

    inserted_after is the source line after which with_listener inserted a line.
    The listener has already supplied its include's pitches and times.
    """
    notes: list[Note] = []
    flags: list[str] = []
    rows = [r.split("\t") for r in tsv.splitlines() if r]
    try:
        rows.sort(key=lambda r: Fraction(r[0]))
        if any(len(r) < 3 for r in rows):
            raise ValueError("short event")
    except (ValueError, IndexError, ZeroDivisionError):
        return NoteSequence((), ("malformed event log",))
    lyrics = {r[0]: r[3] for r in rows if r[2] == "lyric" and len(r) > 3}
    held: dict[str, Note] = {}
    previous: dict[str, Note] = {}
    previous_moment: dict[str, Fraction] = {}
    voices: set[str] = set()
    moments: set[Fraction] = set()
    chant_staffs = {r[1].rsplit(":", 1)[0] for r in rows if r[2] == "note" and r[1].endswith(":chant")}
    coverage: dict[str, list[tuple[Fraction, Fraction]]] = {}
    for r in rows:
        if r[2] == "note" and r[1].endswith(":chant"):
            try:
                onset = Fraction(r[0])
                coverage.setdefault(r[1].rsplit(":", 1)[0], []).append((onset, onset + Fraction(r[9])))
            except (ValueError, IndexError, ZeroDivisionError):
                flags.append("malformed chant duration")
    for r in rows:
        staff, _, voice_id = r[1].rpartition(":")
        if r[2] == "note" and voice_id.isdigit() and staff in chant_staffs:
            onset = Fraction(r[0])
            if not any(start <= onset < end for start, end in coverage.get(staff, [])):
                flags.append("anonymous voice during chant gap requires voice assignment review")
    lyric = ""
    for r in rows:
        voice, kind = r[1:3]
        if kind == "lyric" and len(r) > 3:
            lyric = r[3]
        if not voice.endswith(":chant"):
            continue
        if kind == "tie":
            if voice not in previous or voice in held or previous_moment.get(voice) != Fraction(r[0]):
                flags.append("invalid tie")
            else:
                held[voice] = previous[voice]
        elif kind == "note":
            try:
                step = 7 * int(r[5]) + int(r[3])
                alteration = Fraction(r[4])
                origin = r[10] if len(r) > 10 else ""
                if origin and re.fullmatch(r"\d+:\d+", origin):
                    line, column = map(int, origin.split(":"))
                    if line > inserted_after:
                        line -= 1
                    origin = f"{line}:{column}"
                note = Note(step, alteration, origin, lyrics.get(r[0], lyric))
            except (ValueError, IndexError, ZeroDivisionError):
                flags.append("malformed note event")
                continue
            voices.add(voice)
            moment = Fraction(r[0])
            if moment in moments:
                flags.append("simultaneous chant notes")
            moments.add(moment)
            continuation = held.pop(voice, None)
            previous[voice] = note
            previous_moment[voice] = moment
            if continuation:
                if (continuation.step, continuation.alteration) == (step, alteration):
                    continue
                flags.append("tie changes pitch")
            notes.append(note)
        elif kind in {"rest", "skip"}:
            if voice in held:
                flags.append("tie crosses a rest or skip")
                held.pop(voice)
            previous.pop(voice, None)
            previous_moment.pop(voice, None)
    if held:
        flags.append("dangling tie")
    if len(voices) > 1:
        flags.append("multiple chant voices")
    return NoteSequence(tuple(notes), _unique(flags))


_GROUP = re.compile(r"([^()]*)\(([^()]*)\)")
_CLEF = re.compile(r"([cf])(b?)([1-5])")
_PITCH = re.compile(r"([a-mA-M])([xy#]|\+|v{1,3}|V{1,3}|s{1,3})?")
_REPEAT = re.compile(r"(?<![a-zA-Z])\{?(i?ij)\{?\.")
_UNSUNG = re.compile(r"<(sp|alt|i|v)>.*?</\1>", re.DOTALL)
_TAG = re.compile(r"<[^>]*>")
_NOISE = re.compile(r"\[[^\]]*\]|<[^>]*>")


@dataclass
class _Phrase:
    notes: list[Note] = field(default_factory=list)
    text: str = ""
    half: int | None = None


def read_gabc(gabc: str, expand: bool = False) -> NoteSequence:
    """Read pitches/attacks, keeping uncertain accidentals out of clean results.

    Scope of flat/natural signs needs edition-aware verification; pitch spelling
    after any such sign is deliberately unknown rather than guessed. See the
    Gregorio GABC specification for glyphs, custos and compressed strophas.
    """
    body = re.sub(r"%[^\n]*", "", gabc.split("%%", 1)[-1])
    flags: list[str] = []
    transformations: list[str] = []
    phrases = [_Phrase()]
    clef_letter, clef_step = "j", 0
    saw_clef = False
    cursor = 0
    uncertain_alteration = False
    for m in _GROUP.finditer(body):
        if body[cursor:m.start()].strip():
            flags.append("unparsed GABC text or parentheses")
        cursor = m.end()
        words, raw = m.groups()
        phrase = phrases[-1]
        mark = _REPEAT.search(words)
        clean_words = letters(_TAG.sub("", _UNSUNG.sub(" ", words)))
        if mark and expand:
            times = 3 if mark.group(1) == "iij" else 2
            if not phrase.notes:
                flags.append("repeat with no preceding phrase")
            else:
                phrase.notes *= times
                phrase.text *= times
                transformations.append(f"phrase repeated {times} times")
        phrase.text += clean_words
        if re.search(r"\[(?:[nge]m\d|[nge]v:)", raw):
            flags.append("GABC macro or verbatim notation requires review")
        raw = _NOISE.sub("", raw).strip()
        if "|" in raw or "{" in raw or "}" in raw:
            flags.append("polyphonic or NABC notation requires review")
        group = _CLEF.sub("", raw)
        clef = _CLEF.search(raw)
        if clef:
            if group.strip(" zZ+-"):
                flags.append("clef mixed with notes requires review")
            clef_letter = chr(ord("d") + 2 * (int(clef.group(3)) - 1))
            clef_step = 0 if clef.group(1) == "c" else 3
            saw_clef = True
            if clef.group(2):
                uncertain_alteration = True
                flags.append("GABC accidental scope requires review")
        if group == "::":
            phrases.append(_Phrase())
            continue
        if group == ":" and phrase.half is None:
            phrase.half = len(phrase.notes)
        for pitch in _PITCH.finditer(group):
            letter, suffix = pitch.groups()
            if suffix in {"x", "y", "#"}:
                uncertain_alteration = True
                flags.append("GABC accidental scope requires review")
                continue
            if suffix == "+":
                continue
            count = len(suffix) if suffix and suffix[0] in "vVs" else 1
            step = ord(letter.lower()) - ord(clef_letter) + clef_step
            origin = f"gabc:{m.start(2) + pitch.start() + 1}"
            phrase.notes.extend(Note(step, Fraction(0), origin, clean_words, len(phrases) - 1)
                                for _ in range(count))
        # Consume recognized pitches plus notation modifiers; unknown letters
        # must not silently disappear and allow a false clean result.
        residue = _PITCH.sub("", group)
        if re.search(r"[^\s0-9./!@'_,:;`~<>+\-vVswWoqrRzZ()]+", residue):
            flags.append("unsupported GABC notation requires review")
    if body[cursor:].strip():
        flags.append("unparsed GABC tail")
    if not saw_clef:
        flags.append("GABC has no explicit clef")
    phrases = [p for p in phrases if p.notes or p.text]
    if expand and len(phrases) >= 3 and phrases[-1].text == "euouae" and phrases[-2].text == "gloriapatri":
        verse, ending = phrases[-3], phrases[-1]
        first = verse.notes[:verse.half] if verse.half else verse.notes
        phrases[-2:] = [_Phrase(first + first + ending.notes, DOXOLOGY)]
        transformations.append("doxology reconstructed from psalm tone")
        flags.append("reconstructed doxology requires scan review")
    notes = tuple(n for p in phrases for n in p.notes)
    if uncertain_alteration:
        notes = tuple(Note(n.step, None, n.origin, n.lyric, n.phrase) for n in notes)
    return NoteSequence(notes, _unique(flags), tuple(transformations))


def compare_notes(ours: NoteSequence, chant: NoteSequence) -> Comparison:
    """Align whole sequences; opcodes are diagnosis, never a permissive score."""
    a, b = [n.step for n in ours.notes], [n.step for n in chant.notes]
    flags = _unique([*ours.flags, *chant.flags])
    if not a or not b:
        return Comparison(False, None, None, (), _unique([*flags, "empty note sequence"]))
    offsets = Counter(x - y for x, y in zip(a, b))
    # An insertion shifts zipped indices. Compare a bounded set of likely
    # offsets instead of allowing that shift to move every later note.
    starts = Counter(x - y for x in a[:12] for y in b[:12])
    candidates = list(dict.fromkeys([*(n for n, _ in offsets.most_common(5)),
                                     *(n for n, _ in starts.most_common(5))]))
    aligned = []
    for shift in candidates:
        codes = tuple(SequenceMatcher(None, [n - shift for n in a], b, autojunk=False).get_opcodes())
        cost = sum(max(a2 - a1, b2 - b1) for op, a1, a2, b1, b2 in codes if op != "equal")
        aligned.append((cost, shift, codes))
    _, offset, opcodes = min(aligned, key=lambda row: (row[0], -offsets[row[1]]))
    shifted = [n - offset for n in a]
    equal = shifted == b
    ca, cb = [n.chromatic for n in ours.notes], [n.chromatic for n in chant.notes]
    chromatic: bool | None = None
    if equal and all(n is not None for n in [*ca, *cb]):
        chromatic = len({x - y for x, y in zip(ca, cb)}) == 1
    return Comparison(equal, chromatic, offset, opcodes, flags)
