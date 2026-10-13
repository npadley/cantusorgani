"""Automated pre-review of a rendered evidence packet (the Kyrie IX checklist, per piece).

``precheck_packet(convert_dir)`` reads the converter output and the packet's rendered SVGs
(``evidence/cases/<case>/<case>-p<n>.svg``, laid out by the production ``renderMei``) and lists
findings for a human reviewer. It decides nothing: findings are advice and never touch eligibility,
review state or approval. Checks:

* written head types: every note's MEI ``@dur``/``@dots`` equal the LilyPond notated value;
* tie endpoints: each explicit ``<tie>`` is drawn from the head of its start note to the head of its end note;
* unison heads: chant and accompaniment heads on one pitch and onset are both drawn, side by side;
* divisio ticks: each ``<dir type="divisio-minima">`` crosses the top line of exactly one staff;
* bar lines: a finalis measure end is drawn as a double bar and a divisio maxima as a single bar;
* all 13 required layout cases exist and laid out;
* hidden heads draw nothing: no augmentation dots on a split continuation;
* lyrics: every encoded syllable is drawn; measured gaps below 0.3 mm are nonblocking review advice;
* word-boundary breaks: automatic cases that start a system in the middle of a word (informational).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from itertools import pairwise
from pathlib import Path
from typing import Any

from lxml import etree

from pipeline.typeset.mei.model import REQUIRED_MATRIX

__all__ = ["PRECHECK_VERSION", "precheck_packet"]

#: Bump when a check is added or changed: an automatic approval records the version it was judged under.
PRECHECK_VERSION = "precheck/7"

M = "{http://www.music-encoding.org/ns/mei}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
S = "{http://www.w3.org/2000/svg}"
HEAD_WIDTH = 226.0  # 0.01 mm at staff size medium (unit 9)
SPACE = 180.0
X_SLACK = 150.0
Y_SLACK = 350.0
#: A tie or slur drawn shorter than this (0.01 mm) in mid-system is a stub, not an arc.
MIN_ARC = 100.0
#: Liberation Serif "|": ink from 0.683 em above to 0.217 em below the baseline.
BAR_TOP, BAR_BOTTOM = 0.683, 0.217
_TRANSLATE = re.compile(r"translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?")


def _cls(el: etree._Element) -> list[str]:
    return (el.get("class") or "").split()


class _Page:
    def __init__(self, svg: Path) -> None:
        self.heads: dict[str, tuple[float, float]] = {}
        self.ties: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = defaultdict(list)
        self.ticks: list[tuple[str, float, float, float]] = []
        self.staves: list[tuple[int, float]] = []
        self.ornaments: set[str] = set()
        self.syllables = 0
        self.system_starts: list[str] = []
        self.hidden_dots: list[str] = []  # augmentation dots drawn for a hidden split-continuation head
        self.stemmed_continuations: list[str] = []  # revealed continuations that also draw a stem, flag or accidental
        self._ledgers: list[tuple[str, float, float, float]] = []  # (above|below, x1, x2, y)
        self._head_points: list[tuple[float, float]] = []
        self._arcs: list[tuple[str, float, float]] = []  # (class, min x, max x) of every tie/slur piece
        self._staff_x: list[tuple[float, float]] = []
        self._note = ""
        self._head = False
        self.bars: dict[str, set[int]] = defaultdict(set)  # measure id -> x of every vertical bar line stroke
        self._measure = ""
        self._system = -1
        root = etree.parse(str(svg), etree.XMLParser(resolve_entities=False, no_network=True)).getroot()
        self._walk(root, 0.0, 0.0)
        self.orphan_ledgers, self.stubs = self._finish()

    def _finish(self) -> tuple[list[str], list[str]]:
        """Ledger lines no drawn head stands on (a hidden continuation drew them) and mid-system arc stubs."""
        ys = sorted({y for _s, _a, _b, y in self._ledgers})
        gaps = [b - a for a, b in pairwise(ys) if b - a > 100]
        spacing = min(gaps) if gaps else SPACE
        orphans = [
            f"ledger {x1:.0f}-{x2:.0f} at {y:.0f}"
            for side, x1, x2, y in self._ledgers
            if not any(
                x1 - 60 <= hx <= x2 + 60 and (hy <= y + 0.7 * spacing if side == "above" else hy >= y - 0.7 * spacing)
                for hx, hy in self._head_points
            )
        ]
        stubs: list[str] = []
        if self._staff_x:
            left = min(a for a, _b in self._staff_x)
            right = max(b for _a, b in self._staff_x)
            for cls, lo, hi in self._arcs:
                if hi - lo < MIN_ARC and hi < right - 200 and lo > left + 1200:  # not a piece at a system edge
                    stubs.append(f"{cls} {lo:.0f}-{hi:.0f}")
        return orphans, stubs

    def _walk(self, el: etree._Element, dx: float, dy: float) -> None:
        if el.tag == S + "g":
            m = _TRANSLATE.search(el.get("transform") or "")
            if m:
                dx += float(m.group(1))
                dy += float(m.group(2) or 0)
            cls = _cls(el)
            ident = el.get("id")
            if "bounding-box" not in cls:
                if "mordent" in cls and ident and any(
                    c.tag in (S + "use", S + "path")
                    and not any("bounding-box" in _cls(a) for a in c.iterancestors() if a is not el)
                    for c in el.iter()
                ):
                    self.ornaments.add(ident)
                if "system" in cls:
                    self._system += 1
                if "measure" in cls and ident:
                    self._measure = ident
                    if len(self.system_starts) <= self._system:
                        self.system_starts.append(ident)
                if "barLine" in cls and self._measure:
                    for p in el.iter(S + "path"):
                        mm = re.match(r"^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$", p.get("d") or "")
                        if mm and mm.group(1) == mm.group(3) and mm.group(2) != mm.group(4):
                            self.bars[self._measure].add(round(float(mm.group(1)) / 20))
                if "staff" in cls:
                    ys = [
                        float(mm.group(1)) + dy
                        for p in el.findall(S + "path")
                        if (mm := re.match(r"^M-?[\d.]+ (-?[\d.]+) L-?[\d.]+ (-?[\d.]+)$", p.get("d") or ""))
                        and mm.group(1) == mm.group(2)
                    ]
                    if len(ys) == 5 and (self._system, min(ys)) not in self.staves:
                        self.staves.append((self._system, min(ys)))
                if "ledgerLines" in cls:
                    side = "above" if "above" in cls else "below"
                    for p in el.findall(S + "path"):
                        mm = re.match(r"^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$", p.get("d") or "")
                        if mm:
                            self._ledgers.append((side, float(mm.group(1)) + dx, float(mm.group(3)) + dx, float(mm.group(2)) + dy))
                if "staff" in cls:
                    for p in el.findall(S + "path"):
                        mm = re.match(r"^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$", p.get("d") or "")
                        if mm:
                            self._staff_x.append((float(mm.group(1)) + dx, float(mm.group(3)) + dx))
                if ("tie" in cls or "slur" in cls):
                    path = el.find(S + "path")
                    arc = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", path.get("d") or "")][0::2] if path is not None else []
                    if arc:
                        self._arcs.append((" ".join(cls), min(arc) + dx, max(arc) + dx))
                if "split-continuation" in cls and ident and any(
                    c.tag == S + "g" and "notehead" in _cls(c) and next(iter(c.iter(S + "use")), None) is not None for c in el.iter()
                ) and any(
                    c.tag == S + "g" and (
                        "stem" in _cls(c) or "flag" in _cls(c) or ("accid" in _cls(c) and next(iter(c.iter(S + "use")), None) is not None)
                    ) for c in el.iter()
                ):
                    self.stemmed_continuations.append(ident)
                if "dots" in cls and self._note and not self._head and re.search(r"c\d+$", self._note) and any(
                    c.tag in (S + "ellipse", S + "circle", S + "use", S + "path") for c in el.iter()
                ):
                    self.hidden_dots.append(self._note)
                if "note" in cls and ident:
                    self._note = ident
                    use = next(iter(el.iter(S + "use")), None)
                    self._head = use is not None  # a revealed continuation has a visible head (and legitimate dots)
                    mm = _TRANSLATE.search(use.get("transform") or "") if use is not None else None
                    if mm:
                        self.heads[ident] = (float(mm.group(1)) + dx, float(mm.group(2) or 0) + dy)
                        self._head_points.append(self.heads[ident])
                if "syl" in cls:
                    self.syllables += 1
                if "tie" in cls and "split-tie" not in cls:
                    path = el.find(S + "path")
                    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", path.get("d") or "")] if path is not None else []
                    if len(nums) >= 8:
                        self.ties[ident or ""].append(((nums[0] + dx, nums[1] + dy), (nums[6] + dx, nums[7] + dy)))
                if "dir" in cls and ident:
                    text = el.find(S + "text")
                    sizes = [
                        float(mm.group(1))
                        for t in el.iter(S + "tspan")
                        if (mm := re.fullmatch(r"([\d.]+)px", t.get("font-size") or "")) and float(mm.group(1)) > 0
                    ]
                    if text is not None and sizes and "".join(text.itertext()).strip() == "|":
                        size, y = max(sizes), float(text.get("y", "0")) + dy
                        self.ticks.append((ident, float(text.get("x", "0")) + dx, y - BAR_TOP * size, y + BAR_BOTTOM * size))
        for child in el:
            if isinstance(child.tag, str):
                self._walk(child, dx, dy)


def _near(point: tuple[float, float], head: tuple[float, float], scale: float = 1.0) -> bool:
    return head[0] - X_SLACK <= point[0] <= head[0] + HEAD_WIDTH * scale + X_SLACK and abs(point[1] - head[1]) <= Y_SLACK


def precheck_packet(convert_dir: Path, evidence_dir: Path | None = None) -> dict[str, list[str]]:
    """Findings keyed by ``"piece"`` (not layout dependent) or by layout case id. Empty lists are clean."""
    evidence = evidence_dir or convert_dir / "evidence"
    ir: dict[str, Any] = json.loads((convert_dir / "ir.json").read_text(encoding="utf-8"))
    root = etree.parse(str(convert_dir / "score.mei")).getroot()
    notes = {n.get(XML_ID): n for n in root.iter(M + "note")}
    findings: dict[str, list[str]] = {"piece": []}

    # --- written head types ---
    for event in ir["events"]:
        note = notes.get("ev" + event["id"])
        if event["kind"] != "note" or note is None:
            continue
        want = (str(2 ** event["notated"]["log"]), str(event["notated"]["dots"]) if event["notated"]["dots"] else None)
        head = note.getparent() if note.get("dur") is None and note.getparent().tag == M + "chord" else note  # chord members
        if (head.get("dur"), head.get("dots")) != want:
            findings["piece"].append(f"head type: {event['id']} is dur={head.get('dur')} dots={head.get('dots')}, LilyPond writes {want}")
    explicit_ties = [(t.get(XML_ID), (t.get("startid") or "")[1:], (t.get("endid") or "")[1:]) for t in root.iter(M + "tie")]
    ornaments_wanted = [o.get(XML_ID) for o in root.iter(M + "mordent")]
    ticks_wanted = [d.get(XML_ID) for d in root.iter(M + "dir") if d.get("type") == "divisio-minima"]
    syllables = sum(1 for _ in root.iter(M + "syl"))  # blank syllables carrying an entry marker are drawn too
    if sum(1 for e in ir["events"] if e["kind"] == "note" and e["tieToNext"]) != len(explicit_ties):
        findings["piece"].append("ties: the MEI has a different number of <tie> elements than the source has tied notes")

    staff_of = {layer["id"]: layer["homeStaffId"] for layer in ir["layers"]}
    by_slot: dict[tuple[str, str, str, str, int], list[str]] = defaultdict(list)
    for e in ir["events"]:
        if e["kind"] == "note":
            p = e["pitch"]
            by_slot[(e["staffId"], e["onset"], p["step"], p["alter"], p["octave"])].append(e["id"])
    notated = {e["id"]: (e["notated"]["log"], e["notated"]["dots"]) for e in ir["events"]}
    # Equal head types on one pitch legitimately share a head in LilyPond too; only differing heads must both show.
    unisons = [
        ids for ids in by_slot.values() if len({_layer(ir, i) for i in ids}) > 1 and len({notated[i] for i in ids}) > 1
    ]
    del staff_of

    boundaries = json.loads((convert_dir / "boundaries.json").read_text(encoding="utf-8"))
    after_of_measure = {b["measureId"]: b for b in boundaries}
    syl_before: dict[str, bool] = {}
    for syl in sorted(ir["lyrics"], key=lambda s: s["onset"]):
        syl_before[syl["onset"]] = bool(syl["hyphenAfter"])

    required = {c.id for c in REQUIRED_MATRIX}
    expected_bars = {
        m.get(XML_ID): {"dbl": 2, "single": 1}[m.get("right")] for m in root.iter(M + "measure") if m.get("right") in ("dbl", "single")
    }
    cases_root = evidence / "cases"
    for missing in sorted(required - {p.name for p in cases_root.iterdir() if p.is_dir()}):
        findings[missing] = ["case was not laid out (no folder in the packet)"]
    summary = json.loads((cases_root / "cases.json").read_text(encoding="utf-8"))
    case_evidence = {c["id"]: c for c in summary["cases"]}
    sizes = {c["id"]: c.get("staffHeightMm", 7.2) for c in summary["cases"]}
    problems_by_case = {c["id"]: [d for d in c.get("diagnostics", []) if d.get("severity") == "error"] for c in summary["cases"]}
    for case_dir in sorted(p for p in cases_root.iterdir() if p.is_dir() and p.name not in findings):
        case = case_dir.name
        pages = [_Page(p) for p in sorted(case_dir.glob(f"{case}-p*.svg")) if not p.name.endswith(".bbox.svg")]
        out: list[str] = findings.setdefault(case, [])
        if not pages:
            reasons = "; ".join(f"{d['code']}: {d.get('detail', '')[:120]}" for d in problems_by_case.get(case, []))
            out.append(f"no pages rendered ({reasons or 'no diagnostic'})")
            continue
        # The renderer measures these gaps with the real lyric font. SVG text has
        # no reliable ink box, so do not estimate widths here. D22 keeps info:
        # advice visible in the report without blocking automatic approval.
        for gap in case_evidence.get(case, {}).get("lyricGaps", []):
            if gap["gapMm"] < 0.3:
                system = f", system {gap['system'] + 1}" if "system" in gap else ""
                out.append(
                    f"info: lyrics: {gap['a']!r} / {gap['b']!r} gap {gap['gapMm']:.3f} mm "
                    f"on page {gap['page']}{system} (below 0.3 mm; review warning)"
                )
        scale = float(sizes.get(case, 7.2)) / 7.2  # staff size relative to medium
        drawn_ornaments = set().union(*(page.ornaments for page in pages))
        for ornament_id in ornaments_wanted:
            if ornament_id not in drawn_ornaments:
                out.append(f"ornament {ornament_id}: no drawn glyph")
        heads = {k: v for page in pages for k, v in page.heads.items()}
        page_of = {k: n for n, page in enumerate(pages) for k in page.heads}
        tick_by_id = {t[0]: (page, t) for page in pages for t in page.ticks}
        every_piece = [piece for page in pages for pieces in page.ties.values() for piece in pieces]
        for tie_id, start, end in explicit_ties:
            chain = _chain(notes, start)  # a revealed continuation can carry the tie at a break
            a_heads = [heads[i] for i in chain if i in heads]
            a, b = (a_heads[0] if a_heads else None), heads.get(end)
            if a is None or b is None:
                out.append(f"tie {tie_id}: an end note has no drawn head")
            else:
                starts = any(_near(p[0], h, scale) for p in every_piece for h in a_heads)
                ends = any(_near(p[1], b, scale) for p in every_piece)
                across_pages = page_of.get(start) != page_of.get(end)
                if across_pages and not (starts and ends):
                    out.append(f"tie {tie_id}: crosses a page break and is not fully drawn")
                else:
                    if not starts:
                        out.append(f"tie {tie_id}: no piece starts on the head of {start}")
                    if not ends:
                        out.append(f"tie {tie_id}: no piece ends on the head of {end}")
        for ids in unisons:
            xs = [heads["ev" + i][0] for i in ids if "ev" + i in heads]
            if len(xs) < len(ids):
                out.append(f"unison {ids}: a head is not drawn")
            elif max(xs) - min(xs) < 0.8 * HEAD_WIDTH * scale:
                out.append(f"unison {ids}: heads overlap ({max(xs) - min(xs):.0f} units apart)")
        for tick_id in ticks_wanted:
            found = tick_by_id.get(tick_id or "")
            if found is None:
                out.append(f"divisio {tick_id}: not drawn")
                continue
            page, (_, _x, top, bottom) = found
            crossed = [s for s in page.staves if top < s[1] < bottom]
            if len(crossed) != 1 or abs((top + bottom) / 2 - crossed[0][1]) > SPACE * scale / 2:
                out.append(f"divisio {tick_id}: does not cross exactly one top line (ink {top:.0f}..{bottom:.0f})")
        for page in pages:
            for measure_id, want in expected_bars.items():
                if measure_id in page.bars and len(page.bars[measure_id]) != want:
                    out.append(f"bar line: measure {measure_id} ends with {len(page.bars[measure_id])} bar(s), want {want}")
        dots = [n for page in pages for n in page.hidden_dots]
        if dots:
            out.append(f"dots: {len(dots)} augmentation dot(s) drawn on hidden continuation heads (e.g. {dots[0]})")
        ledgers = [f for page in pages for f in page.orphan_ledgers]
        if ledgers:
            out.append(f"ledger: {len(ledgers)} ledger line(s) with no drawn head on them (a hidden continuation draws them), e.g. {ledgers[0]}")
        stemmed = [n for page in pages for n in page.stemmed_continuations]
        if stemmed:
            out.append(f"stem: {len(stemmed)} revealed continuation(s) draw a stem, flag or accidental (head only, D17), e.g. {stemmed[0]}")
        stubs = [f for page in pages for f in page.stubs]
        if stubs:
            out.append(f"arc: {len(stubs)} tie/slur piece(s) shorter than {MIN_ARC / 100:.1f} mm in mid-system, e.g. {stubs[0]}")
        drawn = sum(page.syllables for page in pages)
        if drawn < syllables:
            out.append(f"lyrics: only {drawn} of {syllables} encoded syllables are drawn")
        elif drawn > syllables:
            out.append(f"info: {drawn - syllables} extra syllable piece(s) drawn at system breaks (continued extenders or hyphens)")
        if case.endswith("-auto") or "-auto" in case:
            mid_word = 0
            unavoidable = 0
            allowed = {
                bid for c in summary["cases"] if c["id"] == case for d in c.get("diagnostics", [])
                if d.get("code") == "MIDWORD_UNAVOIDABLE" for bid in d.get("boundaryIds", [])
            }
            for page in pages:
                for first in page.system_starts[1:]:
                    previous = _previous_measure(root, first)
                    boundary = after_of_measure.get(previous or "")
                    if boundary is not None and syl_before.get(_onset_key(boundary["onset"], syl_before), False):
                        if boundary["id"] in allowed:
                            unavoidable += 1  # D24: the layout kept the hyphenated break and said so
                        else:
                            mid_word += 1
            if unavoidable:
                out.append(f"info: {unavoidable} automatic system(s) start in the middle of a word that no word boundary could avoid (D24)")
            if mid_word:
                out.append(f"note: {mid_word} automatic system(s) start in the middle of a word")
    return findings


def _chain(notes: dict[str | None, etree._Element], start: str) -> list[str]:
    """``start`` and the fragments that continue it (``@next`` links), in order."""
    out, current = [start], start
    while (note := notes.get(current)) is not None and note.get("next"):
        current = (note.get("next") or "")[1:]
        if current in out:
            break
        out.append(current)
    return out


def _layer(ir: dict[str, Any], event_id: str) -> str:
    return next(e["layerId"] for e in ir["events"] if e["id"] == event_id)


def _previous_measure(root: etree._Element, measure_id: str) -> str | None:
    ids = [m.get(XML_ID) for m in root.iter(M + "measure")]
    i = ids.index(measure_id) if measure_id in ids else 0
    return ids[i - 1] if i > 0 else None


def _onset_key(onset: str, syllables: dict[str, bool]) -> str:
    """The onset of the last syllable that starts before ``onset`` (rational strings compared exactly)."""
    from fractions import Fraction

    target = Fraction(onset)
    earlier = [k for k in syllables if Fraction(k) < target]
    return max(earlier, key=Fraction) if earlier else ""
