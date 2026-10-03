"""Independent notehead candidates and source-scan review annotations.

Candidate detection is a baseline, not complete optical music recognition.
It never receives the expected notes and cannot assert voices or durations.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import cv2
import numpy as np

from pipeline.segment import find_staff_lines, group_staves


@dataclass(frozen=True)
class ScanSettings:
    candidate_threshold: float = 0.68


@dataclass(frozen=True)
class Candidate:
    x: int
    y: int
    staff: int
    position: float
    style: str
    score: float
    box: tuple[int, int, int, int]


@dataclass(frozen=True)
class ObservedEvent:
    voice: str | None
    kind: str
    step: int | None = None
    alteration: Fraction | None = None
    onset: Fraction | None = None
    duration: Fraction | None = None
    tie_in: bool | None = None
    tie_out: bool | None = None
    box: tuple[int, int, int, int] | None = None
    system: str = ""


@dataclass
class ScanEvidence:
    events: list[ObservedEvent] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    staves: list[tuple[int, int]] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    complete: bool = False
    reviewer: str = ""
    systems: list[str] = field(default_factory=list)
    transform: str = "identity: input system crop pixels"


def observe_system(image: np.ndarray, settings: ScanSettings) -> ScanEvidence:
    """Find independent scale-normalized candidates in an unrotated crop.

    No cleaning transform changes coordinates. Staff/key, accidental scope,
    duration, ties, overlapping heads and voices remain unassessed. The
    correlation score is not a calibrated probability of correctness.
    """
    if not 0 < settings.candidate_threshold <= 1:
        raise ValueError("candidate threshold must be in (0, 1]")
    result = ScanEvidence(flags=["voice, clef/key, accidentals, rests, spans and ties need review"])
    if image.size == 0:
        result.flags.append("empty scan")
        return result
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if image.ndim != 2 or image.dtype != np.uint8:
        raise ValueError("scan must be a uint8 grayscale or BGR image")
    binary = np.where(image < 128, 0, 255).astype(np.uint8)
    staves = group_staves(find_staff_lines(binary), min_gap=5, max_gap=60)
    result.staves = [(s.top, s.bottom) for s in staves]
    if len(staves) != 2:
        result.flags.append(f"expected two staves, found {len(staves)}")
    if not staves:
        return result
    proposals = []
    ink = 255 - binary
    height, width = binary.shape
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN,
                                 np.ones((1, max(20, width // 4)), np.uint8))
    ink = cv2.subtract(ink, horizontal)
    for staff_id, staff in enumerate(staves):
        spacing = (staff.bottom - staff.top) / 4
        tw = th = max(11, round(spacing * 1.6) + 5)
        if height < th or width < tw:
            continue
        styles = [(style, thickness, angle, width_ratio, height_ratio, phase) for style, thickness in
                  (("filled", -1), ("open", max(1, round(spacing * .12))))
                  for angle in (-15, -35, -45)
                  for width_ratio, height_ratio in ((.7, .3), (.55, .45))
                  for phase in (-1, 0, .5)]
        templates = []
        for style, thickness, angle, width_ratio, height_ratio, phase in styles:
            rx, ry = max(3, round(spacing * width_ratio)), max(2, round(spacing * height_ratio))
            template = np.zeros((th, tw), np.uint8)
            cv2.ellipse(template, (tw // 2, th // 2), (rx, ry), angle, 0, 360, 255, thickness)
            if phase >= 0:
                for offset in (-1, 0, 1):
                    row = round(th // 2 + (offset + phase) * spacing)
                    template[max(0, row - 1):min(th, row + 2)] = 0
            templates.append((template, style))
        # Empirical printed glyphs are calibrated from scan pixels alone. Keep
        # their source-piece family out of held-out benchmark measurements.
        bank = Path(__file__).parent / "scan-templates"
        provenance = json.loads((bank / "provenance.json").read_text())
        for item in provenance["templates"]:
            prototype = cv2.imread(str(bank / item["image"]), cv2.IMREAD_GRAYSCALE)
            if prototype is None:
                raise ValueError("missing printed scan template")
            scale = spacing / item["spacing"]
            prototype = cv2.resize(prototype, None, fx=scale, fy=scale,
                                   interpolation=cv2.INTER_NEAREST)
            templates.append((prototype, item["style"]))
        for template, style in templates:
            th, tw = template.shape
            if th > height or tw > width:
                continue
            scores = cv2.matchTemplate(ink, template, cv2.TM_CCOEFF_NORMED)
            ys, xs = np.where((scores >= settings.candidate_threshold)
                              & (scores == cv2.dilate(scores, np.ones((3, 3), np.uint8))))
            for y, x in zip(ys.tolist(), xs.tolist(), strict=True):
                cy, cx = y + th // 2, x + tw // 2
                if staff.top - 2 * spacing <= cy <= staff.bottom + 2 * spacing:
                    proposals.append(Candidate(cx, cy, staff_id,
                                               (staff.bottom - cy) / (spacing / 2),
                                               style, float(scores[y, x]), (x, y, x + tw, y + th)))
    # Suppress overlapping template responses, not source ink. Every original
    # pixel stays available in the report for inspecting missed glyphs.
    for c in sorted(proposals, key=lambda p: p.score, reverse=True):
        spacing = (staves[c.staff].bottom - staves[c.staff].top) / 4
        if not any(abs(c.x - p.x) < spacing and abs(c.y - p.y) < spacing / 2
                   for p in result.candidates):
            result.candidates.append(c)
    result.candidates.sort(key=lambda c: (c.staff, c.x, c.y))
    result.flags.append("candidate detection is incomplete and may include non-note glyphs")
    return result


def _fraction(value: object) -> Fraction | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 50:
        raise ValueError("fractions must be exact strings")
    try:
        return Fraction(value)
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError("invalid fraction") from exc


def load_reviewed_observations(path: Path, scan_hash: str) -> ScanEvidence:
    """Load asserted independent scan readings; preserve who reviewed what.

    No automated proofreading acknowledgment is issued by this loader. Annotate
    a complete score with score-relative onsets and the printed note segments;
    retain each tied segment instead of collapsing it into a single event.
    """
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("schema_version") != 1:
        raise ValueError("unsupported observations schema")
    if doc.get("scan_hash") != scan_hash or not re.fullmatch(r"[a-f0-9]{64}", scan_hash):
        raise ValueError("stale scan observations")
    if (doc.get("basis") != "source-scan" or not isinstance(doc.get("reviewer"), str)
            or not doc["reviewer"].strip() or type(doc.get("complete")) is not bool):
        raise ValueError("independent reviewer and boolean completeness required")
    systems = doc.get("systems")
    if (not isinstance(systems, list) or not systems
            or not all(isinstance(s, str) and re.fullmatch(r"noh[1-8]/\d{4}/\d{3}", s)
                       for s in systems) or len(set(systems)) != len(systems)):
        raise ValueError("unique source systems required")
    raw = doc.get("events")
    if not isinstance(raw, list) or not raw:
        raise ValueError("review has no events")
    result = ScanEvidence(complete=doc["complete"], reviewer=doc["reviewer"], systems=systems)
    for row in raw:
        if not isinstance(row, dict):
            raise TypeError("event must be an object")
        if row.get("voice") not in (None, "alto", "tenor", "bass"):
            raise ValueError("unknown accompaniment voice")
        if row.get("kind") not in ("note", "rest"):
            raise ValueError("scan event must be note or rest")
        if row.get("system") not in systems:
            raise ValueError("event does not belong to source systems")
        step = row.get("step")
        if step is not None and (type(step) is not int or not -70 <= step <= 70):
            raise ValueError("invalid diatonic pitch")
        onset, duration, alteration = (_fraction(row.get(k)) for k in
                                        ("onset", "duration", "alteration"))
        if (onset is not None and onset < 0) or (duration is not None and duration <= 0):
            raise ValueError("invalid event timing")
        for name in ("tie_in", "tie_out"):
            if row.get(name) is not None and type(row[name]) is not bool:
                raise ValueError("tie evidence must be boolean")
        box = row.get("box")
        if (not isinstance(box, list) or len(box) != 4
                or any(type(n) is not int or n < 0 for n in box)
                or box[0] >= box[2] or box[1] >= box[3]):
            raise ValueError("source event box required")
        if doc["complete"] and (row.get("voice") is None or onset is None or duration is None
                                or (row["kind"] == "note" and (step is None or alteration is None
                                    or row.get("tie_in") is None or row.get("tie_out") is None))):
            raise ValueError("complete review requires all note properties")
        result.events.append(ObservedEvent(row.get("voice"), row["kind"], step, alteration,
                                           onset, duration, row.get("tie_in"), row.get("tie_out"),
                                           tuple(box), row["system"]))
    if not doc["complete"]:
        result.flags.append("partial source-scan review")
    return result
