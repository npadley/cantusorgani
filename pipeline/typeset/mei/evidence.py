"""Review evidence packet for one MEI conversion (cards A5b and A5c).

``build_evidence`` turns a ``typeset-mei-convert`` output directory into one self-contained
``index.html`` that a human reviewer opens to approve conversion fidelity (gate G1). For every
``REQUIRED_MATRIX`` case it shows the MEI pages (laid out by the production ``renderMei`` through
``web/scripts/render-mei-cases.ts``, never a parallel renderer) next to the LilyPond original and the
scan, all at one physical scale (1 CSS mm = 1 mm), with the page frame drawn.

Geometry findings (``GEOMETRY_CLIPPING``, ``GEOMETRY_COLLISION``) are flags for the reviewer only.
Nothing here builds or changes a ``ConversionRecord`` or a ``ValidationReport``: a flag can never set
``eligible`` or a review state.

The page has no scripts, no external requests and inline CSS only; every image is a ``data:`` URI.
"""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import html
import json
import re
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from lxml import etree

from pipeline.typeset import lilypond
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.extract import BUILD_ROOT
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    EvidencePacket,
    LayoutCase,
)

__all__ = [
    "EvidenceError",
    "build_evidence",
    "default_lilypond_svg",
    "default_scan_images",
    "geometry_findings",
    "run_node_renderer",
]

WEB = lilypond.ROOT / "web"
SCRIPT = "scripts/render-mei-cases.ts"
UNRECORDED = "unrecorded"
#: Overshoot beyond the page viewBox that still counts as inside (0.1 mm; viewBox units are 0.01 mm).
CLIP_TOLERANCE_UNITS = 10.0
#: Average advance of a lyric glyph in em, for the estimated lyric boxes (Verovio gives none).
LYRIC_EM_WIDTH = 0.45
#: Boxes of these containers are not glyphs.
_CONTAINERS = frozenset(
    {"mdiv", "score", "page", "system", "measure", "staff", "layer", "verse", "syl", "text", "section",
     "pageMilestone", "systemMilestone", "page-margin", "bounding-box"}
)

NodeRunner = Callable[[Path, list[LayoutCase], Path, Path | None], None]
LilyPondSvg = Callable[[str, Path], Path | None]
ScanImages = Callable[[str | None], list[Path]]


class EvidenceError(Exception):
    """The evidence packet cannot be built (bad input, missing tool or unreadable renderer output)."""


# --- the real renderer ------------------------------------------------------------------------------


def _case_dict(case: LayoutCase) -> dict[str, Any]:
    return {
        "id": case.id, "page": case.page, "orientation": case.orientation, "staff": case.staff,
        "line_policy": case.line_policy, "max_systems": case.max_systems,
    }


def run_node_renderer(mei: Path, cases: list[LayoutCase], out: Path, boundaries: Path | None) -> None:
    """Run ``web/scripts/render-mei-cases.ts`` (real Verovio WASM, production ``renderMei``)."""
    node = shutil.which("node")
    if node is None:
        raise EvidenceError("node is not installed; it is needed to lay out the MEI pages")
    if not (WEB / "node_modules" / "verovio").is_dir():
        raise EvidenceError("web/node_modules is missing; run `pnpm install` in web/")
    out.mkdir(parents=True, exist_ok=True)
    cases_file = out / "requested-cases.json"
    cases_file.write_text(json.dumps([_case_dict(c) for c in cases], indent=2) + "\n", encoding="utf-8")
    command = [
        node, "--import", "./scripts/register-extensionless.mjs", SCRIPT,
        str(mei.resolve()), str(cases_file.resolve()), str(out.resolve()),
    ]
    if boundaries is not None:
        command.append(str(boundaries.resolve()))
    done = subprocess.run(command, cwd=WEB, capture_output=True, text=True, timeout=600, check=False)
    if done.returncode != 0:
        raise EvidenceError(f"render-mei-cases failed ({done.returncode}): {(done.stderr or done.stdout).strip()[-800:]}")


# --- comparison material: LilyPond original and scans --------------------------------------------------


def default_lilypond_svg(source_path: str, work: Path) -> Path | None:
    """The book-line-break (``wide.svg``) render of the source: an existing published render under
    ``build/typeset/out/<hash>/`` when there is one, otherwise rendered now with the pinned LilyPond
    into ``work``. ``None`` when neither is possible."""
    from pipeline.typeset import render

    source = lilypond.ROOT / source_path
    try:
        digest = render.source_hash(source.read_text(encoding="utf-8"))
        existing = lilypond.ROOT / "build" / "typeset" / "out" / digest / "wide.svg"
        if existing.is_file():
            return existing
        rendered = render.render(source, work)
    except (OSError, lilypond.LilyPondError):
        return None
    wide = work / rendered.hash / "wide.svg"
    return wide if rendered.ok and wide.is_file() else None


def default_scan_images(target: str | None) -> list[Path]:
    """Scan images (``build/systems/.../NNN@2x.webp``) for the whole matched span of ``target``,
    through ``proofread.scan_span``; no new catalogue matching."""
    if target is None:
        return []
    from pipeline.typeset.proofread import scan_span

    slug = re.sub(r"^[a-z]+:", "", target).split("/")[0]
    catalog = json.loads((lilypond.ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
    piece = next((p for p in catalog.get("pieces", []) if p.get("slug") == slug), None)
    if piece is None:
        return []
    found: list[Path] = []
    for ref in scan_span(piece, target):
        if not re.fullmatch(r"noh[1-8]/\d{4}/\d{3}", ref):
            continue
        base = lilypond.ROOT / "build" / "systems" / Path(ref).parent
        for suffix in ("@2x.webp", "@2x.png", ".webp"):
            image = base / f"{Path(ref).name}{suffix}"
            if image.is_file():
                found.append(image)
                break
    return found


# --- geometry flags (A5c) ----------------------------------------------------------------------------------


_TRANSLATE = re.compile(r"translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?")


def _classes(element: etree._Element) -> list[str]:
    return (element.get("class") or "").split()


def _local(element: etree._Element) -> str:
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def _parse_svg(text: str) -> etree._Element:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    return etree.fromstring(text.encode("utf-8"), parser)


def _viewbox(element: etree._Element) -> list[float]:
    try:
        return [float(v) for v in (element.get("viewBox") or "").split()]
    except ValueError:
        return []


def _walk(
    element: etree._Element, dx: float, dy: float, system: int, systems: list[int]
) -> Iterator[tuple[etree._Element, float, float, int]]:
    """(element, accumulated translate x, y, system ordinal) for every element, depth first."""
    if _local(element) == "g":
        match = _TRANSLATE.search(element.get("transform") or "")
        if match:
            dx += float(match.group(1))
            dy += float(match.group(2) or 0)
        if "system" in _classes(element) and "bounding-box" not in _classes(element):
            systems.append(len(systems))
            system = systems[-1]
    yield element, dx, dy, system
    for child in element:
        if isinstance(child.tag, str):
            yield from _walk(child, dx, dy, system, systems)


def _text_box(text: etree._Element, dx: float, dy: float) -> tuple[float, float, float, float, str] | None:
    """Estimated box of one lyric ``<text>``: Verovio reports no bounding box for lyric text."""
    content = "".join(text.itertext()).strip()
    sizes = [
        float(m.group(1)) for el in text.iter() if (m := re.fullmatch(r"([\d.]+)px", el.get("font-size") or ""))
        and float(m.group(1)) > 0
    ]
    try:
        x, y = float(text.get("x", "")), float(text.get("y", ""))
    except ValueError:
        return None
    if not content or not sizes:
        return None
    size = max(sizes)
    left = x + dx
    return left, y + dy - 0.8 * size, left + len(content) * size * LYRIC_EM_WIDTH, y + dy + 0.2 * size, content


def geometry_findings(case_id: str, svg: Path) -> list[Diagnostic]:
    """Flags for one rendered page: glyph boxes outside the page ``viewBox`` (``GEOMETRY_CLIPPING``)
    and overlapping lyric text in one system (``GEOMETRY_COLLISION``). The Verovio bounding-box
    render ``<stem>.bbox.svg`` next to ``svg`` is used when present. Flags only: warning severity,
    never blocking, and nothing here can touch eligibility or a review state."""
    source = svg.with_name(svg.name[: -len(".svg")] + ".bbox.svg") if svg.name.endswith(".svg") else svg
    path = source if source.is_file() else svg
    page = path.name.removesuffix(".bbox.svg").removesuffix(".svg")
    try:
        root = _parse_svg(path.read_text(encoding="utf-8"))
    except (OSError, etree.XMLSyntaxError) as error:
        return [Diagnostic("GEOMETRY_CLIPPING", "warning", f"{page}: cannot read the SVG for geometry checks: {error}",
                           details=(("case", case_id), ("page", page)))]
    inner = next((c for c in root if isinstance(c.tag, str) and "definition-scale" in _classes(c)), None)
    box = _viewbox(inner) if inner is not None else []
    if len(box) != 4:
        return []
    width, height = box[2], box[3]
    clipped: list[tuple[str, float]] = []
    lyrics: dict[int, list[tuple[float, float, float, float, str]]] = {}
    for element, dx, dy, system in _walk(inner, 0.0, 0.0, -1, []):
        name = _local(element)
        parent_classes = _classes(element.getparent()) if element.getparent() is not None else []
        if name == "rect" and "bounding-box" in parent_classes:
            kinds = [c for c in parent_classes if c not in _CONTAINERS]
            if not kinds or any(c in _CONTAINERS for c in parent_classes if c != "bounding-box"):
                continue
            try:
                x, y, w, h = (float(element.get(k, "")) for k in ("x", "y", "width", "height"))
            except ValueError:
                continue
            over = max(-(x + dx), -(y + dy), x + dx + w - width, y + dy + h - height)
            if over > CLIP_TOLERANCE_UNITS:
                owner = element.getparent().getparent() if element.getparent().getparent() is not None else element
                clipped.append((f"{kinds[0]} {owner.get('id') or ''}".strip(), over / 100))
        elif name == "text" and "syl" in (_classes(element.getparent()) if element.getparent() is not None else []):
            measured = _text_box(element, dx, dy)
            if measured is not None:
                lyrics.setdefault(system, []).append(measured)
    findings: list[Diagnostic] = []
    if clipped:
        worst = max(c[1] for c in clipped)
        findings.append(Diagnostic(
            "GEOMETRY_CLIPPING", "warning",
            f"{page}: {len(clipped)} glyph box(es) extend outside the page, worst by {worst:.2f} mm "
            f"({', '.join(c[0] for c in clipped[:3])}{'...' if len(clipped) > 3 else ''})",
            details=(("case", case_id), ("count", str(len(clipped))), ("page", page), ("worst_mm", f"{worst:.2f}")),
        ))
    pairs: list[str] = []
    for boxes in lyrics.values():
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                if min(a[2], b[2]) - max(a[0], b[0]) > 0 and min(a[3], b[3]) - max(a[1], b[1]) > 0:
                    pairs.append(f"{a[4]!r} / {b[4]!r}")
    if pairs:
        findings.append(Diagnostic(
            "GEOMETRY_COLLISION", "warning",
            f"{page}: {len(pairs)} overlapping lyric pair(s), estimated from text length ({', '.join(pairs[:3])}"
            f"{'...' if len(pairs) > 3 else ''})",
            details=(("case", case_id), ("count", str(len(pairs))), ("page", page)),
        ))
    return findings


# --- inputs and validation shown in the header ------------------------------------------------------


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise EvidenceError(f"cannot read {path}: {error}") from error


def _manifest_entry(source_path: str) -> dict[str, str] | None:
    parts = json.loads((lilypond.ROOT / "data" / "typeset" / "manifest.json").read_text(encoding="utf-8"))["parts"]
    relative = source_path.removeprefix("data/typeset/src/")
    return next((p for p in parts if p["file"] == relative), None)


def _inputs_without_record(ir: dict[str, Any], profile_id: str) -> ConversionInputs:
    """Inputs derived exactly as the manifest builder does (``current_inputs_from_files``); versions
    the convert directory does not record are shown as unrecorded."""
    from pipeline.typeset.mei.manifest import current_inputs_from_files

    skeleton = ConversionRecord(
        source_path=ir["sourcePath"], target=None, render_hash=None, state="needs-review",
        inputs=ConversionInputs(
            source_sha256="", include_sha256="", lilypond_version=str(ir["lilypondVersion"]),
            extractor_version=str(ir["extractorVersion"]), converter_version=UNRECORDED, profile_id=profile_id,
            profile_sha256="", schema_sha256="", verovio_version=UNRECORDED, font_digest=UNRECORDED,
        ),
        artifact_sha256=None, diagnostics=(), validation=None, review=None,
    )
    return current_inputs_from_files(skeleton)


def _checks(convert_dir: Path, ir: dict[str, Any]) -> tuple[bool, list[str], list[str]]:
    """(schema_ok, schema messages, differences) for a convert directory with no record.

    TODO(A4b): replace the equality comparison with ``validate.compare_scores`` (coded differences with
    source_event_ids) once ``pipeline/typeset/mei/validate.py`` is merged. Until then the independent
    reader (``normalize_mei``) is compared with ``normalize_ir`` and any inequality is listed."""
    from pipeline.typeset.mei.cli import PROFILE_PATH
    from pipeline.typeset.mei.encode import encode_score
    from pipeline.typeset.mei.model import ConversionProfile, ScoreIR
    from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
    from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema

    xml = (convert_dir / "score.mei").read_bytes()
    schema = validate_schema(xml, load_schema_bundle())
    score = ScoreIR.from_dict(ir)
    provenance = encode_score(score, ConversionProfile.load(PROFILE_PATH)).provenance
    expected, actual = normalize_ir(score), normalize_mei(xml, provenance)
    differences: list[str] = []
    for field in dataclasses.fields(expected):
        a, b = getattr(expected, field.name), getattr(actual, field.name)
        if a == b:
            continue
        if field.name == "layers":
            for key in sorted(set(a) | set(b)):
                if a.get(key) != b.get(key):
                    differences.append(f"layer {key}: {len(a.get(key, ()))} source events vs {len(b.get(key, ()))} in MEI")
        else:
            differences.append(f"{field.name} differ")
    return not schema, [d.message for d in schema], differences


# --- html ----------------------------------------------------------------------------------------------------


_MIME = {".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp"}


def _data_uri(path: Path) -> str:
    mime = _MIME.get(path.suffix.lower(), "application/octet-stream")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _svg_size_mm(path: Path) -> tuple[float, float] | None:
    """Physical size of a LilyPond SVG (``width``/``height`` are points)."""
    try:
        root = _parse_svg(path.read_text(encoding="utf-8"))
        return float(str(root.get("width")).removesuffix("pt")) * 25.4 / 72, float(str(root.get("height")).removesuffix("pt")) * 25.4 / 72
    except (OSError, ValueError, etree.XMLSyntaxError):
        return None


def _image_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8X" and len(data) >= 30:
            return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
        if data[12:16] == b"VP8 " and len(data) >= 30:
            return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
        if data[12:16] == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _row(label: str, value: object) -> str:
    return f"<tr><th>{_e(label)}</th><td>{_e(value)}</td></tr>"


CSS = """
:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--muted:#5b5b60;--line:#c9c9ce;--page:#f4f1ea;--warn:#8a4b00;--bad:#a4161a;--ok:#176b2c}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--muted:#a2a2aa;--line:#3b3b42;--page:#2a2924;--warn:#f0b35a;--bad:#ff8a8d;--ok:#6fd187}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px 16px 64px}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px}h3{font-size:.95rem;margin:12px 0 4px;color:var(--muted)}
table{border-collapse:collapse;max-width:100%}th,td{border:1px solid var(--line);padding:3px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:600;white-space:nowrap}td{font-family:ui-monospace,monospace;font-size:.85rem}
.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok);font-weight:600}.warn{color:var(--warn)}.muted{color:var(--muted)}
.case{border-top:2px solid var(--line);margin-top:24px;padding-top:8px}
.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;overflow-x:auto}
figure{margin:0}figcaption{font-size:.8rem;color:var(--muted);margin-bottom:4px}
.frame{position:relative;background:var(--page);border:1px solid var(--fg);box-sizing:content-box}
.frame .inner{position:absolute;outline:1px dashed var(--line);background:#fff}
.frame img,.pane{display:block}.pane{background-repeat:no-repeat;background-size:100% 100%;background-color:#fff}
.orig{background-image:var(--orig)}
.note{font-size:.85rem;color:var(--muted);border:1px dashed var(--line);padding:8px;max-width:60ch}
nav ul{columns:3;margin:4px 0;padding-left:18px}
@media print{nav{display:none}}
""".strip()


def _frame(case_id: str, page_no: int, count: int, info: dict[str, Any], svg: Path) -> str:
    w, h = float(info["pageWidthMm"]), float(info["pageHeightMm"])
    m, cw, ch = float(info["marginMm"]), float(info["contentWidthMm"]), float(info["contentHeightMm"])
    return (
        f'<figure><figcaption>MEI page {page_no} of {count} &middot; {w:g} &times; {h:g} mm &middot; margin {m:g} mm</figcaption>'
        f'<div class="frame" style="width:{w:g}mm;height:{h:g}mm">'
        f'<div class="inner" style="left:{m:g}mm;top:{m:g}mm;width:{cw:g}mm;height:{ch:g}mm">'
        f'<img alt="{_e(case_id)} page {page_no}" src="{_data_uri(svg)}" style="width:{cw:g}mm;height:auto"></div></div></figure>'
    )


def _diagnostic_rows(diagnostics: list[dict[str, Any]]) -> str:
    if not diagnostics:
        return '<p class="muted">None.</p>'
    rows = []
    for d in diagnostics:
        place = d.get("location") or ""
        css = {"error": "bad", "warning": "warn"}.get(d["severity"], "muted")
        rows.append(
            f'<tr><td class="{css}">{_e(d["severity"])}</td><td>{_e(d["code"])}</td><td>{_e(d["message"])}</td>'
            f"<td>{_e(place)}</td><td>{_e(', '.join(d.get('eventIds') or []))}</td></tr>"
        )
    return "<table><tr><th>Severity</th><th>Code</th><th>Message</th><th>Source</th><th>Events</th></tr>" + "".join(rows) + "</table>"


def _diag_from_json(d: dict[str, Any]) -> dict[str, Any]:
    loc = d.get("sourceLocation")
    return {**d, "location": f"{loc['filename']}:{loc['line']}:{loc['column']}" if loc else ""}


def _diag_from_object(d: Diagnostic) -> dict[str, Any]:
    loc = d.source_location
    return {
        "severity": d.severity, "code": d.code, "message": d.message, "eventIds": list(d.event_ids),
        "location": f"{loc.filename}:{loc.line}:{loc.column}" if loc else "",
    }


# --- the builder -------------------------------------------------------------------------------------------------


def build_evidence(
    convert_dir: Path,
    record: ConversionRecord | None,
    out: Path | None,
    *,
    node_runner: NodeRunner = run_node_renderer,
    lilypond_svg: LilyPondSvg = default_lilypond_svg,
    scan_images: ScanImages = default_scan_images,
    build_root: Path = BUILD_ROOT,
) -> EvidencePacket:
    """Write ``index.html`` and the per-case SVGs under ``out`` (default
    ``build_root/<inputs digest>/evidence``) and return the packet.

    ``record`` supplies the inputs, tool versions, validation and diagnostics when the caller has
    one; with ``None`` they are derived from the convert directory. The inputs always come from
    ``manifest.current_inputs_from_files`` so a packet and the manifest agree on the digests."""
    for name in ("score.mei", "ir.json", "diagnostics.json", "boundaries.json"):
        if not (convert_dir / name).is_file():
            raise EvidenceError(f"{convert_dir} is not a typeset-mei-convert output: {name} is missing")
    ir = _read_json(convert_dir / "ir.json")
    source_path = record.source_path if record else str(ir["sourcePath"])
    mei = convert_dir / "score.mei"
    artifact_sha256 = hashlib.sha256(mei.read_bytes()).hexdigest()

    profile_id = record.inputs.profile_id if record else _profile_id()
    inputs = record.inputs if record else _inputs_without_record(ir, profile_id)
    entry = _manifest_entry(source_path)
    target = record.target if record else (entry["target"] if entry else None)
    render_hash = record.render_hash if record else (entry["hash"] if entry else None)
    directory = out if out is not None else build_root / inputs.digest() / "evidence"
    cases_root = directory / "cases"
    if cases_root.exists():
        shutil.rmtree(cases_root)
    directory.mkdir(parents=True, exist_ok=True)

    cases = list(REQUIRED_MATRIX)
    node_runner(mei, cases, cases_root, convert_dir / "boundaries.json")
    summary = _read_json(cases_root / "cases.json") if (cases_root / "cases.json").is_file() else None
    if not isinstance(summary, dict) or not isinstance(summary.get("cases"), list):
        raise EvidenceError("the renderer wrote no readable cases.json")
    info = {c["id"]: c for c in summary["cases"]}
    missing = [c.id for c in cases if c.id not in info]
    if missing:
        raise EvidenceError(f"the renderer produced no result for {', '.join(missing)}")

    findings: list[Diagnostic] = []
    case_files: dict[str, Path] = {}
    pages: dict[str, list[Path]] = {}
    for case in cases:
        files = [cases_root / name for name in info[case.id].get("files", [])]
        pages[case.id] = [f for f in files if f.is_file()]
        if pages[case.id]:
            case_files[case.id] = pages[case.id][0]
        for svg in pages[case.id]:
            findings.extend(geometry_findings(case.id, svg))

    work = directory / "lilypond"
    original = lilypond_svg(source_path, work)
    scans = [s for s in scan_images(target) if s.is_file()]

    if record is not None and record.validation is not None:
        v = record.validation
        schema_ok, schema_messages = v.schema_ok, [d.message for d in v.schema_diagnostics]
        differences = [f"{s.code}: {s.detail}" for s in v.semantic_differences]
        tool_versions = dict(v.tool_versions)
        hashes = dict(v.hashes)
        validation_note = "from the conversion record"
    else:
        schema_ok, schema_messages, differences = _checks(convert_dir, ir)
        tool_versions, hashes = {}, {}
        validation_note = "computed here from the convert directory (schema, then normalize_ir vs normalize_mei)"
    diagnostics = (
        [_diag_from_object(d) for d in record.diagnostics]
        if record is not None
        else [_diag_from_json(d) for d in _read_json(convert_dir / "diagnostics.json")]
    )

    page = _render_html(
        source_path=source_path, target=target, render_hash=render_hash, inputs=inputs, artifact_sha256=artifact_sha256,
        ir=ir, verovio=str(summary.get("verovio") or UNRECORDED), record=record, schema_ok=schema_ok,
        schema_messages=schema_messages, differences=differences, validation_note=validation_note,
        tool_versions=tool_versions, hashes=hashes, diagnostics=diagnostics, findings=findings,
        cases=cases, info=info, pages=pages, original=original, original_is_cached=_is_cached(original, work), scans=scans,
    )
    index = directory / "index.html"
    index.write_text(page, encoding="utf-8")
    return EvidencePacket(directory=directory, index_html=index, cases=case_files, geometry_findings=tuple(findings))


def _profile_id() -> str:
    from pipeline.typeset.mei.cli import PROFILE_PATH
    from pipeline.typeset.mei.model import ConversionProfile

    return ConversionProfile.load(PROFILE_PATH).id


def _is_cached(original: Path | None, work: Path) -> bool:
    return original is not None and work not in original.parents


def _render_html(
    *, source_path: str, target: str | None, render_hash: str | None, inputs: ConversionInputs, artifact_sha256: str,
    ir: dict[str, Any], verovio: str, record: ConversionRecord | None, schema_ok: bool, schema_messages: list[str],
    differences: list[str], validation_note: str, tool_versions: dict[str, str], hashes: dict[str, str],
    diagnostics: list[dict[str, Any]], findings: list[Diagnostic], cases: list[LayoutCase], info: dict[str, Any],
    pages: dict[str, list[Path]], original: Path | None, original_is_cached: bool, scans: list[Path],
) -> str:
    orig_size = _svg_size_mm(original) if original else None
    flagged = {(dict(f.details).get("case")) for f in findings}
    out: list[str] = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f"<title>MEI evidence: {_e(Path(source_path).name)}</title>",
    ]
    style = CSS
    if original is not None:
        style += f"\n.orig{{--orig:url({_data_uri(original)})}}"
    for i, scan in enumerate(scans):
        style += f"\n.scan{i}{{background-image:url({_data_uri(scan)})}}"
    out += [f"<style>{style}</style></head><body>", "<h1>MEI conversion evidence</h1>"]
    out.append(
        '<p class="muted">For the human reviewer (gate G1). Pages are drawn at true size (1 mm = 1 CSS mm at 100% zoom) '
        "with the production layout code. Geometry findings below are flags only: they never decide eligibility or approval.</p>"
    )
    out.append("<h2>Conversion</h2><table>")
    for label, value in (
        ("source", source_path), ("target", target or "(no matching entry in data/typeset/manifest.json)"),
        ("render hash", render_hash or "-"), ("artifact (score.mei) sha256", artifact_sha256),
        ("inputs digest", inputs.digest()), ("record state", record.state if record else "(no record; convert directory only)"),
    ):
        out.append(_row(label, value))
    out.append("</table><h3>Inputs</h3><table>")
    for field in dataclasses.fields(inputs):
        out.append(_row(field.name, getattr(inputs, field.name)))
    out.append("</table><h3>Tool versions</h3><table>")
    for label, value in (
        ("lilypond", ir.get("lilypondVersion")), ("extractor", ir.get("extractorVersion")),
        ("converter", inputs.converter_version), ("verovio (rendered with)", verovio),
        ("verovio (recorded)", inputs.verovio_version), *sorted(tool_versions.items()), *sorted(hashes.items()),
    ):
        out.append(_row(label, value))
    out.append("</table>")
    cls = "ok" if schema_ok else "bad"
    out.append(f"<h2>Validation</h2><p class=\"muted\">{_e(validation_note)}. Zero differences are expected.</p>")
    out.append(f'<p class="{cls}">Schema: {"valid" if schema_ok else "INVALID"}</p>')
    out += [f"<p class=\"bad\">{_e(m)}</p>" for m in schema_messages[:10]]
    out.append(f'<p class="{"ok" if not differences else "bad"}">Semantic differences: {len(differences)}</p>')
    if differences:
        out.append("<ul>" + "".join(f"<li>{_e(d)}</li>" for d in differences) + "</ul>")
    out.append(f"<h2>Diagnostics ({len(diagnostics)})</h2>")
    out.append(_diagnostic_rows(diagnostics))
    out.append(f"<h2>Geometry findings ({len(findings)}) &mdash; flags only</h2>")
    if findings:
        out.append('<p class="muted">Flags only; they do not set eligibility or the review state.</p>')
        out.append("<table><tr><th>Code</th><th>Case</th><th>Finding</th></tr>" + "".join(
            f"<tr><td>{_e(f.code)}</td><td>{_e(dict(f.details).get('case', ''))}</td><td>{_e(f.message)}</td></tr>" for f in findings
        ) + "</table>")
    else:
        out.append('<p class="muted">None found (flags only; they never decide approval).</p>')
    out.append("<h2>Cases</h2><nav><ul>")
    for case in cases:
        mark = " &#9873;" if case.id in flagged else ""
        out.append(f'<li><a href="#case-{_e(case.id)}">{_e(case.id)}</a> ({info[case.id].get("pageCount", 0)} p){mark}</li>')
    out.append("</ul></nav>")
    for case in cases:
        out.append(_render_case(case, info[case.id], pages[case.id], original, original_is_cached, orig_size, scans))
    out.append("</body></html>")
    return "\n".join(out)


def _render_case(
    case: LayoutCase, info: dict[str, Any], pages: list[Path], original: Path | None, cached: bool,
    orig_size: tuple[float, float] | None, scans: list[Path],
) -> str:
    cap = "all systems" if case.max_systems is None else f"cap {case.max_systems}"
    systems = ", ".join(str(n) for n in info.get("systemsPerPage", []))
    out = [
        f'<section class="case" id="case-{_e(case.id)}"><h2>{_e(case.id)}</h2>',
        (
            f'<p class="muted">{_e(case.page)} {_e(case.orientation)} &middot; staff {_e(case.staff)} &middot; '
            f"{_e(case.line_policy)} lines &middot; {_e(cap)} &mdash; {info.get('pageCount', 0)} page(s), systems per page [{_e(systems)}], "
            f"staff height {info.get('staffHeightMm', 0)} mm (expected {info.get('expectedStaffHeightMm', 0)} mm)</p>"
        ),
    ]
    for d in info.get("diagnostics", []):
        out.append(f'<p class="{"bad" if d.get("severity") == "error" else "warn"}">{_e(d.get("code"))}: {_e(d.get("detail"))}</p>')
    if not pages:
        out.append('<p class="bad">No pages were produced for this case.</p>')
    out.append('<div class="row">')
    for n, svg in enumerate(pages, start=1):
        out.append(_frame(case.id, n, len(pages), info, svg))
    if original is not None and orig_size is not None:
        w, h = orig_size
        origin = "existing published render" if cached else "rendered now with the pinned LilyPond"
        out.append(
            f'<figure><figcaption>LilyPond original ({origin}; the book\'s own line breaks) &middot; {w:g} &times; {h:g} mm</figcaption>'
            f'<div class="pane orig" role="img" aria-label="LilyPond original" style="width:{w:g}mm;height:{h:g}mm"></div></figure>'
        )
    else:
        out.append('<div class="note">no LilyPond original: it was not available for this source.</div>')
    if scans:
        width = orig_size[0] if orig_size else 190.0
        parts = []
        for i, scan in enumerate(scans):
            size = _image_size(scan)
            ratio = f"{size[0]} / {size[1]}" if size else "4 / 1"
            parts.append(
                f'<div class="pane scan{i}" role="img" aria-label="Scan system {i + 1}" '
                f'style="width:{width:g}mm;aspect-ratio:{ratio};margin-bottom:2mm"></div>'
            )
        out.append(
            f'<figure><figcaption>Scan ({len(scans)} system(s) of the matched span; each scaled to the original&#39;s '
            f"{width:g} mm line width, so its physical scale is approximate)</figcaption>{''.join(parts)}</figure>"
        )
    else:
        out.append('<div class="note">no scan: nothing is matched to this target in the catalogue.</div>')
    out.append("</div></section>")
    return "".join(out)
