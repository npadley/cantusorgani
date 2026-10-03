"""Local, reproducible accompaniment audit packets; never publishes or edits scores."""
from __future__ import annotations

import hashlib
import html
import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict
from fractions import Fraction
from pathlib import Path

import cv2

from pipeline import sections
from pipeline.typeset import events, lilypond
from pipeline.typeset.accompaniment_compare import compare_accompaniment
from pipeline.typeset.scan_observations import (
    ScanEvidence,
    ScanSettings,
    load_reviewed_observations,
    observe_system,
)
from pipeline.typeset.score_events import ScoreEvidence, read_score
from pipeline.volumes import ROOT

ALGORITHM = "accompaniment-audit-1"


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def scan_digest(scans: list[tuple[str, bytes]]) -> str:
    return digest(json.dumps([(ref, digest(body)) for ref, body in scans],
                             separators=(",", ":")).encode())


def source_span(piece: dict, target: str) -> list[str]:
    systems = piece.get("systems", [])
    if target == f"piece:{piece['slug']}":
        return list(systems)
    starts = {sections.target(piece["slug"], s): s["system"]
              for s in sections.printed(piece)}
    starts.update({f"movement:{piece['slug']}/{m['movement']}": systems.index(m["ref"])
                   for m in piece.get("movements", []) if m.get("ref") in systems})
    start = starts.get(target)
    if start is None or not 0 <= start < len(systems):
        return []
    end = min([s for s in starts.values() if s > start] + [len(systems)])
    return systems[start:end]


def _json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False,
                      default=lambda v: str(v) if isinstance(v, Fraction) else asdict(v))


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(body, encoding="utf-8")
    temporary.replace(path)


def _image_path(scan_root: Path, ref: str) -> Path:
    if not re.fullmatch(r"noh[1-8]/\d{4}/\d{3}", ref):
        raise ValueError("invalid scan reference")
    for name in (ref, ref.replace("/", "-")):
        for extension in (".png", ".jpg", ".webp"):
            path = scan_root / (name + extension)
            if path.is_file() and path.resolve().is_relative_to(scan_root.resolve()):
                return path
    raise ValueError(f"missing scan {ref}; supply its local system crop under --scan-root")


def _annotation_path(annotations: Path | None, filename: str) -> Path | None:
    if annotations is None:
        return None
    if annotations.is_file():
        return annotations
    path = annotations / (filename.replace("/", "__") + ".json")
    return path if path.is_file() else None


def audit(files: list[str], out: Path, scan_root: Path, annotations: Path | None = None,
          *, root: Path = ROOT, settings: ScanSettings | None = None,
          score_reader: Callable[[Path], ScoreEvidence] = read_score) -> dict:
    if not files:
        raise ValueError("choose at least one source file")
    if annotations and annotations.is_file() and len(files) != 1:
        raise ValueError("one annotation file applies to one source; use an annotation directory for a batch")
    src = root / "data/typeset/src"
    for filename in files:
        path = Path(filename)
        if (path.is_absolute() or ".." in path.parts or path.suffix != ".ly"
                or not (src / path).resolve().is_relative_to(src.resolve())):
            raise ValueError(f"unsafe source filename {filename!r}")
    manifest = json.loads((root / "data/typeset/manifest.json").read_text())
    catalogue = json.loads((root / "data/catalog.json").read_text())
    chants = json.loads((root / "data/chants.json").read_text()).get("chants", {})
    matches = {r["file"]: r for r in manifest["parts"]}
    pieces = {p["slug"]: p for p in catalogue["pieces"]}
    settings = settings or ScanSettings()
    code_hash = digest(b"".join(p.read_bytes() for p in sorted(Path(__file__).parent.glob("*.py")))
                       + events.LISTEN.read_bytes()
                       + b"".join(p.read_bytes() for p in sorted(
                           (Path(__file__).parent / "scan-templates").glob("*")))
                       + b"".join(p.read_bytes() for p in sorted(lilypond.INCLUDE.glob("*.ily"))))
    rows = []
    for filename in dict.fromkeys(files):
        row = {"file": filename, "status": "blocked", "flags": [], "full_proofread": False}
        try:
            source = src / filename
            source_hash = digest(source.read_bytes())
            match = matches.get(filename)
            if match is None:
                raise ValueError("no confirmed catalogue target for this source")
            target = match["target"]
            piece = pieces[target.split(":", 1)[1].split("/", 1)[0]]
            refs = source_span(piece, target)
            if not refs:
                raise ValueError("no source-system span")
            paths = [_image_path(scan_root, ref) for ref in refs]
            scan_hash = scan_digest([(ref, p.read_bytes()) for ref, p in zip(refs, paths, strict=True)])
            chant_id = next((s.get("gregobase_id") for s in sections.printed(piece)
                             if sections.target(piece["slug"], s) == target), None)
            gabc = chants.get(str(chant_id), {}).get("gabc")
            annotation = _annotation_path(annotations, filename)
            annotation_hash = digest(annotation.read_bytes()) if annotation else None
            inputs = {"source_hash": source_hash, "scan_hash": scan_hash, "systems": refs,
                      "target": target, "gabc_hash": digest(gabc.encode()) if gabc else None,
                      "annotation_hash": annotation_hash, "code_hash": code_hash,
                      "algorithm": ALGORITHM, "settings": asdict(settings),
                      "lilypond": lilypond.load_pin().version}
            key = digest(_json(inputs).encode())
            row.update(inputs, input_hash=key, render_hash=match.get("hash"))
            folder = out / "cache" / key
            cached = folder / "result.json"
            if cached.exists():
                previous = json.loads(cached.read_text())
                pictures_exist = all((out / p[k]).is_file()
                                     for p in previous.get("pictures", [])
                                     for k in ("original", "overlay"))
                if (previous.get("input_hash") == key and previous.get("status") != "blocked"
                        and pictures_exist):
                    rows.append(previous)
                    continue
            folder.mkdir(parents=True, exist_ok=True)
            score = score_reader(source)
            row["expected_events"] = [asdict(e) for e in score.events]
            if score.flags:
                row["flags"] = score.flags
                rows.append(row)
                continue
            observed = load_reviewed_observations(annotation, scan_hash) if annotation else ScanEvidence()
            if annotation and observed.systems != refs:
                raise ValueError("review source systems do not match this exact part span")
            pictures, scan_candidates = [], []
            for ref, path in zip(refs, paths, strict=True):
                image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
                if image is None:
                    raise ValueError(f"unreadable image {ref}")
                if any(e.box and (e.box[2] > image.shape[1] or e.box[3] > image.shape[0])
                       for e in observed.events if e.system == ref):
                    raise ValueError(f"review box outside source scan {ref}")
                candidates = observe_system(image, settings)
                scan_candidates.append({"system": ref, **asdict(candidates)})
                if not annotation:
                    observed.flags.extend(candidates.flags)
                    observed.candidates.extend(candidates.candidates)
                name = ref.replace("/", "-")
                original, overlay = folder / f"{name}.png", folder / f"{name}-overlay.png"
                cv2.imwrite(str(original), image)
                colour = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                for c in candidates.candidates:
                    cv2.rectangle(colour, c.box[:2], c.box[2:], (0, 100, 255), 2)
                for e in observed.events:
                    if e.system == ref and e.box:
                        cv2.rectangle(colour, e.box[:2], e.box[2:], (0, 160, 0), 2)
                        cv2.putText(colour, e.voice or "?", (e.box[0], max(15, e.box[1] - 3)),
                                    cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 160, 0), 1)
                cv2.imwrite(str(overlay), colour)
                pictures.append({"system": ref, "original": original.relative_to(out).as_posix(),
                                 "overlay": overlay.relative_to(out).as_posix()})
            comparison = compare_accompaniment(score, observed)
            row.update(asdict(comparison), pictures=pictures, scan_candidates=scan_candidates,
                       observations=asdict(observed), scope="accompaniment only",
                       reviewer=observed.reviewer,
                       review_requirements=["independent source-scan readings of all accompanying voices",
                                            "confirm full part span, lyrics and layout separately"])
            _write(folder / "observations-template.json", _json({
                "schema_version": 1, "scan_hash": scan_hash, "systems": refs,
                "reviewer": "", "basis": "source-scan", "complete": False, "events": []}))
            _write(cached, _json(row))
        except (OSError, ValueError, TypeError, KeyError, cv2.error) as exc:
            row.update(status="blocked", flags=[str(exc)])
        rows.append(row)
    report = {"schema_version": 1, "algorithm": ALGORITHM, "full_proofread": False,
              "counts": dict(Counter(r["status"] for r in rows)), "files": rows}
    _write(out / "report.json", _json(report))
    _write(out / "index.html", _html(report))
    return report


def _html(report: dict) -> str:
    parts = ['<!doctype html><meta charset="utf-8"><title>Accompaniment scan validation</title>',
             ('<style>body{font:16px system-ui;margin:2rem;max-width:1200px}img{width:100%}'
              'pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #aaa;padding:1rem 0}</style>'),
             ('<h1>Accompaniment scan validation</h1><p>Candidate overlays need review. '
              'This report never marks full proofreading complete.</p>')]
    for row in report["files"]:
        parts.append(f'<section><h2>{html.escape(row["file"])}</h2>'
                     f'<p>{html.escape(row["status"])}</p>')
        for picture in row.get("pictures", []):
            parts.append(f'<h3>{html.escape(picture["system"])}</h3>'
                         f'<img src="{html.escape(picture["original"], quote=True)}" alt="Original scan">'
                         f'<img src="{html.escape(picture["overlay"], quote=True)}" alt="Candidate and reviewed observations">')
        parts.append('<pre>' + html.escape(_json({k: row.get(k) for k in
                                                 ("properties", "discrepancies", "flags", "review_requirements")}))
                     + '</pre></section>')
    return "\n".join(parts)
