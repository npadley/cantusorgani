"""Is this transcription's chant voice the melody of that chant?

The transcription's chant voice (pipeline/typeset/events.py) and a GregoBase
chant's GABC are both reduced to diatonic steps, then to the intervals between
consecutive notes, which do not change when NOH transposes a chant to suit the
organ. The score is how much of the transcription's melody the chant contains,
in order: GregoBase often carries more than NOH prints (an Introit's psalm verse
and Gloria Patri), so the chant is not penalised for being longer.

GregoBase abbreviates what NOH prints in full: "Kyrie eleison. iij." is sung
three times, and "Alleluia. ij." twice before its jubilus. read() can write
those repeats out, and agreement() scores a transcription against the chant
both ways and keeps the better. It compares the words the same way (as letters:
NOH's syllables do not always join into GregoBase's words), so a chant with the
right notes and another text -- the type-melodies -- does not pass for it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from itertools import pairwise

_GROUP = re.compile(r"\(([^)]*)\)")
_CLEF = re.compile(r"^(c|f)b?([1-5])$")
# Inside a neume group: [..] tags and <..> never hold pitches.
_NOISE = re.compile(r"\[[^\]]*\]|<[^>]*>")
_PITCH = re.compile(r"([a-mA-M])([xy#]?)(\+?)")


# A neume group, or the text before it. In the text: a repeat mark ("ij.",
# "iij.", GregoBase sets it in <i>), tags that are not sung (<sp>V/</sp>,
# <alt>..</alt>), and tags around sung text (<nlba>, <clear>).
_TOKEN = re.compile(r"\(([^)]*)\)|([^(]+)")
_REPEAT = re.compile(r"(?<![a-zA-Z])\{?(i?ij)\{?\.")
_UNSUNG = re.compile(r"<(sp|alt|i|v)>.*?</\1>", re.DOTALL)
_TAG = re.compile(r"<[^>]*>")
_TIMES = {"ij": 2, "iij": 3}


def letters(text: str) -> str:
    """Latin text as bare letters: no accents, ae for æ, i for j, so NOH's
    "Jubiláte" and GregoBase's "Iubilate" are the same."""
    plain = unicodedata.normalize("NFKD", text.lower().replace("æ", "ae").replace("œ", "oe"))
    plain = "".join(c for c in plain if not unicodedata.combining(c)).replace("j", "i")
    return re.sub(r"[^a-z]", "", plain)


@dataclass(frozen=True)
class Chant:
    """A GregoBase chant as it is sung: each note's diatonic step, and its words
    as bare letters."""
    steps: tuple[int, ...]
    text: str


#: The doxology an Introit's "Gloria Patri. E u o u a e" stands for.
DOXOLOGY = letters("Gloria Patri et Filio et Spiritui Sancto sicut erat in principio et nunc et semper "
                   "et in saecula saeculorum Amen")


@dataclass
class _Phrase:
    """What lies between two double bars."""
    steps: list[int]
    text: list[str]
    #: How many notes come before its first half bar (a psalm verse's mediant).
    half: int | None = None


@lru_cache(maxsize=4096)
def read(gabc: str, expand: bool = False) -> Chant:
    """Each note's diatonic step (C = 0), following clef changes, and the text.
    A pitch letter followed by x, y or # is an accidental, and one followed by +
    a custos (the next line's first note, shown at the end of a line): neither
    is sung. With `expand`, what GregoBase abbreviates is written out as NOH
    prints it:
    - a repeat mark repeats the phrase before it (back to the last double bar),
      once more for "ij.", twice more for "iij.";
    - an Introit's "Gloria Patri. E u o u a e" becomes the whole doxology, sung
      as the psalm verse is: its first half twice, then the ending given."""
    body = gabc.split("%%", 1)[-1]
    clef_letter, clef_step = "j", 0                       # c4 until a clef says otherwise
    phrases = [_Phrase([], [])]
    for group, words in _TOKEN.findall(body):
        phrase = phrases[-1]
        if words:
            mark = _REPEAT.search(words)
            if mark and expand:
                phrase.text.append(letters(_TAG.sub("", _UNSUNG.sub(" ", words[:mark.start()]))))
                again = _TIMES[mark.group(1)] - 1
                phrase.steps += phrase.steps * again
                phrase.text += phrase.text * again
            else:
                phrase.text.append(letters(_TAG.sub("", _UNSUNG.sub(" ", words))))
            continue
        group = _NOISE.sub("", group).strip()
        clef = _CLEF.match(group)
        if clef:
            line = int(clef.group(2))
            clef_letter = chr(ord("d") + 2 * (line - 1))       # line 1 is d, line 2 f, line 3 h, line 4 j
            clef_step = 0 if clef.group(1) == "c" else 3        # the line is C, or F
            continue
        if group == "::":
            phrases.append(_Phrase([], []))
            continue
        if group == ":" and phrase.half is None:
            phrase.half = len(phrase.steps)
            continue
        for letter, accidental, custos in _PITCH.findall(group):
            if accidental or custos:
                continue
            phrase.steps.append(ord(letter.lower()) - ord(clef_letter) + clef_step)
    phrases = [ph for ph in phrases if ph.steps or "".join(ph.text)]
    if expand:
        _write_out_the_doxology(phrases)
    return Chant(tuple(n for ph in phrases for n in ph.steps), "".join(t for ph in phrases for t in ph.text))


def _write_out_the_doxology(phrases: list[_Phrase]) -> None:
    """...verse (::) Gloria Patri. (::) E u o u a e. -> the verse, then the doxology in full."""
    if len(phrases) < 3 or "".join(phrases[-1].text) != "euouae" or "".join(phrases[-2].text) != "gloriapatri":
        return
    verse, ending = phrases[-3], phrases[-1]
    first_half = verse.steps[:verse.half] if verse.half else verse.steps
    phrases[-2:] = [_Phrase(first_half + first_half + ending.steps, [DOXOLOGY])]


def gabc_steps(gabc: str) -> tuple[int, ...]:
    """The chant's notes as written, repeats not written out."""
    return read(gabc).steps


def intervals(steps: tuple[int, ...]) -> tuple[int, ...]:
    """The moves between notes. A repeated note is not a move: GABC writes a
    distropha or a repercussion as separate notes where NOH ties or restrikes
    one, and neither changes the melody."""
    moves = (b - a for a, b in pairwise(steps))
    return tuple(m for m in moves if m != 0)


@dataclass(frozen=True)
class Comparison:
    #: How much of the transcription's melody the chant has, in order (0-1).
    score: float
    notes: int
    chant_notes: int

    def __str__(self) -> str:
        return f"{self.score:.2f} of {self.notes} notes"


def compare(ours: tuple[int, ...], chant: tuple[int, ...]) -> Comparison:
    a, b = intervals(ours), intervals(chant)
    if not a or not b:
        return Comparison(0.0, len(ours), len(chant))
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return Comparison(round(matched / len(a), 3), len(ours), len(chant))


def text_score(ours: str, chant: str) -> float | None:
    """How much of the transcription's text the chant has, in order (0-1), or
    None when either has none to compare."""
    if not ours or not chant:
        return None
    matcher = SequenceMatcher(None, ours, chant, autojunk=False)
    return round(sum(block.size for block in matcher.get_matching_blocks()) / len(ours), 3)


@dataclass(frozen=True)
class Agreement:
    #: How much of the transcription's melody the chant has (0-1).
    melody: float
    #: How much of its words (0-1); None when there are none to compare.
    words: float | None


def agreement(steps: tuple[int, ...], words: tuple[str, ...], gabc: str, with_words: bool = True) -> Agreement:
    """The transcription against the chant as GregoBase writes it and with its
    repeats written out: the better of the two, for the melody and for the words."""
    ours = letters(" ".join(words)) if with_words else ""
    melody, text = 0.0, None
    for chant in (read(gabc), read(gabc, expand=True)):
        melody = max(melody, compare(steps, chant.steps).score)
        score = text_score(ours, chant.text)
        if score is not None:
            text = score if text is None else max(text, score)
    return Agreement(melody, text)


__all__ = ["Agreement", "Chant", "Comparison", "agreement", "compare", "gabc_steps", "intervals", "letters", "read",
           "text_score"]
