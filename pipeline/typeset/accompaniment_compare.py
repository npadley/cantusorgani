"""Complete, conservative comparisons against independently reviewed scan events."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from itertools import zip_longest

from pipeline.typeset.scan_observations import ScanEvidence
from pipeline.typeset.score_events import ScoreEvidence

PROPERTIES = ("voice", "pitch", "onset", "span", "rests", "ties", "completeness")


@dataclass
class ComparisonEvidence:
    status: str = "needs-review"
    properties: dict[str, str] = field(default_factory=dict)
    discrepancies: list[dict] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    full_proofread: bool = False


def compare_accompaniment(score: ScoreEvidence, scan: ScanEvidence) -> ComparisonEvidence:
    result = ComparisonEvidence(properties={p: "not-assessed" for p in PROPERTIES},
                                flags=[*score.flags, *scan.flags])
    claims: dict[str, list[str]] = {p: [] for p in PROPERTIES}

    def record(name, expected, actual, a=None, b=None):
        if expected is None or actual is None:
            claims[name].append("unresolved")
        elif expected == actual:
            claims[name].append("agrees")
        else:
            claims[name].append("differs")
            result.discrepancies.append({"property": name,
                                         "voice": a.voice if a else b.voice if b else None,
                                         "expected": str(expected), "observed": str(actual),
                                         "origin": a.origin if a else "",
                                         "box": b.box if b else None,
                                         "system": b.system if b else ""})

    expected = [e for e in score.events if e.voice in ("alto", "tenor", "bass")
                and e.kind != "skip"]
    if not expected:
        result.flags.append("no expected accompaniment")
    if any(e.voice is None for e in scan.events):
        claims["voice"].append("unresolved")
        claims["completeness"].append("unresolved")
    for voice in ("alto", "tenor", "bass"):
        ours = sorted([e for e in expected if e.voice == voice], key=lambda e: e.onset)
        observed = sorted([e for e in scan.events if e.voice == voice],
                          key=lambda e: (e.onset is None, e.onset or 0))
        if not ours:
            result.flags.append(f"no expected {voice} events")
        if scan.complete and scan.reviewer and not any(e.voice is None for e in scan.events):
            record("completeness", len(ours), len(observed))
        else:
            claims["completeness"].append("unresolved")
        if scan.complete:
            pairs = list(zip_longest(ours, observed))
        else:
            pairs = []
            for b in observed:
                anchors = [a for a in ours if b.onset is not None and a.onset == b.onset]
                if len(anchors) == 1:
                    pairs.append((anchors[0], b))
                else:
                    result.flags.append(f"unanchored partial {voice} observation")
                    claims["onset"].append("unresolved")
        for a, b in pairs:
            if a is None or b is None:
                # Partial annotations cannot establish that an unlisted note is absent.
                if scan.complete and scan.reviewer and not any(e.voice is None for e in scan.events):
                    record("completeness", a.kind if a else "absent", b.kind if b else "absent", a, b)
                continue
            record("voice", a.voice, b.voice, a, b)
            record("rests", a.kind, b.kind, a, b)
            record("onset", a.onset, b.onset, a, b)
            record("span", a.duration, b.duration, a, b)
            if a.kind == b.kind == "note":
                record("pitch", a.step, b.step, a, b)
                record("pitch", a.alteration, b.alteration, a, b)
                record("ties", a.tie_in, b.tie_in, a, b)
                record("ties", a.tie_out, b.tie_out, a, b)
    # Same chord content with changed voice identities is specifically a voice error.
    a_notes = [e for e in expected if e.kind == "note"]
    b_notes = [e for e in scan.events if e.kind == "note" and e.voice is not None]
    a_pitches = Counter((e.onset, e.step, e.alteration) for e in a_notes)
    b_pitches = Counter((e.onset, e.step, e.alteration) for e in b_notes)
    if a_pitches and a_pitches == b_pitches:
        a_voices = Counter((e.onset, e.step, e.alteration, e.voice) for e in a_notes)
        b_voices = Counter((e.onset, e.step, e.alteration, e.voice) for e in b_notes)
        record("voice", a_voices, b_voices)
    for name, values in claims.items():
        result.properties[name] = ("differs" if "differs" in values else
                                   "unresolved" if "unresolved" in values else
                                   "agrees" if values else "not-assessed")
    if "differs" in result.properties.values():
        result.status = "discrepancy"
    elif (all(v == "agrees" for v in result.properties.values()) and not result.flags
          and scan.complete and scan.reviewer):
        result.status = "agrees"
    return result
