"""Is this transcription's chant voice the melody of that chant?

The transcription's chant voice (pipeline/typeset/events.py) and a GregoBase
chant's GABC are both reduced to diatonic steps, then to the intervals between
consecutive notes, which do not change when NOH transposes a chant to suit the
organ. The score is how much of the transcription's melody the chant contains,
in order: GregoBase often carries more than NOH prints (an Introit's psalm verse
and Gloria Patri), so the chant is not penalised for being longer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from itertools import pairwise

_GROUP = re.compile(r"\(([^)]*)\)")
_CLEF = re.compile(r"^(c|f)b?([1-5])$")
# Inside a neume group: [..] tags and <..> never hold pitches.
_NOISE = re.compile(r"\[[^\]]*\]|<[^>]*>")
_PITCH = re.compile(r"([a-mA-M])([xy#]?)(\+?)")


def gabc_steps(gabc: str) -> tuple[int, ...]:
    """Each note's diatonic step (C = 0), following clef changes. A pitch letter
    followed by x, y or # is an accidental, and one followed by + a custos
    (the next line's first note, shown at the end of a line): neither is sung."""
    body = gabc.split("%%", 1)[-1]
    clef_letter, clef_step = "j", 0                       # c4 until a clef says otherwise
    steps: list[int] = []
    for group in _GROUP.findall(body):
        group = _NOISE.sub("", group).strip()
        clef = _CLEF.match(group)
        if clef:
            line = int(clef.group(2))
            clef_letter = chr(ord("d") + 2 * (line - 1))       # line 1 is d, line 2 f, line 3 h, line 4 j
            clef_step = 0 if clef.group(1) == "c" else 3        # the line is C, or F
            continue
        for letter, accidental, custos in _PITCH.findall(group):
            if accidental or custos:
                continue
            steps.append(ord(letter.lower()) - ord(clef_letter) + clef_step)
    return tuple(steps)


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


__all__ = ["Comparison", "compare", "gabc_steps", "intervals"]
