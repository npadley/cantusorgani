"""A local, hash-aware melody audit. Never changes proofreading acknowledgments."""
from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any

from pipeline import sections
from pipeline.typeset import events, proof_notes
from pipeline.typeset.importer import INCLUDES
from pipeline.typeset.lilypond import INCLUDE, LilyPondError, load_pin
from pipeline.typeset.manifest import effective
from pipeline.typeset.match import SRC, targets
from pipeline.typeset.render import source_hash
from pipeline.typeset.source_check import check_file
from pipeline.volumes import DATA, ROOT

ALGORITHM = "melody-audit-1"
DEFAULT_OUT = ROOT / "build" / "typeset" / "proofread"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def scan_span(piece: dict[str, Any], target: str) -> list[str]:
    """Whole matched span, including every system up to the next boundary."""
    systems = piece.get("systems") or []
    if target == f"piece:{piece['slug']}":
        return list(systems)
    boundaries = {int(s["system"]) for s in sections.printed(piece)}
    boundaries.update(systems.index(m["ref"]) for m in piece.get("movements", []) if m["ref"] in systems)
    start = next((int(s["system"]) for s in sections.printed(piece)
                  if sections.target(piece["slug"], s) == target), None)
    if start is None:
        start = next((systems.index(m["ref"]) for m in piece.get("movements", [])
                      if target == f"movement:{piece['slug']}/{m['movement']}" and m["ref"] in systems), None)
    if start is None or not 0 <= start < len(systems):
        return []
    end = min((b for b in boundaries if b > start), default=len(systems))
    return systems[start:end]


def inventory(manifest: dict | None = None, reviewed: dict | None = None,
              catalog: dict | None = None, chants: dict | None = None,
              entries: list[dict] | None = None, src: Path = SRC) -> list[dict]:
    """Remaining matched files, with selected GABC and historical triage bins."""
    manifest = manifest if manifest is not None else json.loads((DATA / "typeset/manifest.json").read_text())
    reviewed = reviewed if reviewed is not None else json.loads((DATA / "reviewed.json").read_text())
    catalog = catalog if catalog is not None else json.loads((DATA / "catalog.json").read_text())
    chants = chants if chants is not None else json.loads((DATA / "chants.json").read_text())["chants"]
    entries = entries if entries is not None else effective()
    by_file = {e["file"]: e for e in entries}
    by_target = {t.target: t for t in targets(catalog, lambda ref: None)}
    pieces = {p["slug"]: p for p in catalog.get("pieces", [])}
    out = []
    for part in manifest["parts"]:
        acknowledged = reviewed.get("reviewed", {}).get(f"typeset:{part['file']}", {}).get("was") == part["hash"]
        try:
            current_hash = source_hash((src / part["file"]).read_text(encoding="utf-8"))
        except OSError:
            current_hash = None
        stale = current_hash != part["hash"]
        if acknowledged and not stale:
            continue
        target = by_target.get(part["target"])
        chant = chants.get(str(target.chant)) if target and target.chant else None
        gabc = chant.get("gabc") if chant else None
        evidence = by_file.get(part["file"], {}).get("evidence") or {}
        score = evidence.get("melody")
        stratum = ("no-gabc" if not gabc else "unscored" if score is None else
                   "perfect" if score == 1 else "near" if score >= .99 else "different")
        piece = pieces.get(target.slug) if target else None
        scans = []
        if piece:
            assets = dict(zip(piece.get("systems", []), piece.get("system_assets", [])))
            scans = [{"ref": ref, "asset": assets.get(ref)} for ref in scan_span(piece, part["target"])]
        out.append({**part, "manifest_stale": stale, "chant_id": target.chant if target else None, "gabc": gabc,
                    "historical_score": score, "stratum": stratum, "scans": scans})
    return sorted(out, key=lambda i: i["file"])


def select_pilot(items: list[dict], limit: int) -> list[dict]:
    """Stable round-robin strata; zero selects all, independent of input order."""
    if limit < 0:
        raise ValueError("limit must be nonnegative")
    groups: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        groups[item["stratum"]].append(item)
    for group in groups.values():
        group.sort(key=lambda i: digest(i["file"]))
    selected = []
    while groups and (limit == 0 or len(selected) < limit):
        for key in sorted(groups):
            selected.append(groups[key].pop(0))
            if not groups[key]:
                del groups[key]
            if limit and len(selected) >= limit:
                break
    return selected


def _note(note: proof_notes.Note) -> dict:
    row = asdict(note)
    row["alteration"] = str(note.alteration) if note.alteration is not None else None
    return row


def _listener_line(text: str) -> int:
    for pattern in (r'^\s*\\include\s+"noh2\.ily".*$', r'^\s*\\version\s+"[^"]*".*$'):
        m = re.search(pattern, text, re.MULTILINE)
        if m:
            return text[:m.end()].count("\n") + (not m.group().endswith("\n"))
    return 0


def _source_excerpt(text: str, notes: list[dict]) -> str:
    lines = text.splitlines()
    numbers = set()
    for note in notes:
        origin = note.get("origin", "")
        if re.fullmatch(r"\d+:\d+", origin):
            at = int(origin.split(":")[0])
            numbers.update(range(max(1, at - 2), min(len(lines), at + 2) + 1))
    return "\n".join(f"{n:4}: {lines[n - 1]}" for n in sorted(numbers))


def difference_kind(ours: proof_notes.NoteSequence, chant: proof_notes.NoteSequence,
                    transposition: int) -> str:
    a = [n.step - transposition for n in ours.notes]
    b = [n.step for n in chant.notes]
    collapsed_a = [n for i, n in enumerate(a) if i == 0 or n != a[i - 1]]
    collapsed_b = [n for i, n in enumerate(b) if i == 0 or n != b[i - 1]]
    if a != b and collapsed_a == collapsed_b:
        return "repeated-attacks"
    if a != b and a and b and (a == b[:len(a)] or b == a[:len(b)]):
        return "ending-or-extra-section"
    return "pitch-or-order"


def audit_one(item: dict, src: Path = SRC, cache: Path = events.CACHE) -> dict:
    row = {k: v for k, v in item.items() if k != "gabc"}
    row.update(full_proofread=False, flags=[], discrepancies=[], transformations=[])
    gabc = item.get("gabc")
    if not gabc:
        return {**row, "status": "no-reference", "flags": ["no catalogue-selected GABC"]}
    row["gabc_hash"] = digest(gabc)
    relative = Path(item["file"])
    if relative.is_absolute() or ".." in relative.parts:
        return {**row, "status": "blocked", "flags": ["unsafe source filename"]}
    path = src / relative
    try:
        text = path.read_text(encoding="utf-8")
        row["source_hash"] = digest(text)
        if source_hash(text) != item["hash"]:
            return {**row, "status": "blocked", "flags": ["manifest render hash is stale; regenerate it"]}
        problems = check_file(path, frozenset(INCLUDES))
        # Shared includes are executable input too. Check them before extraction.
        for include in INCLUDE.glob("*.ily"):
            problems.extend(check_file(include, frozenset(INCLUDES)))
        if problems:
            return {**row, "status": "blocked", "flags": [str(p) for p in problems]}
        key = events.cache_key(text, load_pin().version)
        row["event_key"] = key
        extracted = events.read(path, cache=cache)
        if not extracted.ok:
            return {**row, "status": "blocked", "flags": [extracted.error or "event extraction failed"]}
        ours = proof_notes.read_events((cache / f"{key}.tsv").read_text(), _listener_line(text))
    except (OSError, LilyPondError, ValueError) as error:
        return {**row, "status": "blocked", "flags": [str(error)]}
    candidates = [proof_notes.read_gabc(gabc), proof_notes.read_gabc(gabc, expand=True)]
    compared = [(candidate, proof_notes.compare_notes(ours, candidate)) for candidate in candidates]
    # Diagnose the closest complete interpretation; no best-of scoring can
    # convert a partial sequence into a pass.
    chant, comparison = min(compared, key=lambda pair: (
        not pair[1].diatonic_equal,
        sum(max(a2 - a1, b2 - b1) for op, a1, a2, b1, b2 in pair[1].opcodes if op != "equal"),
        len(pair[0].transformations)))
    row.update(ours_notes=len(ours.notes), chant_notes=len(chant.notes),
               transposition=comparison.transposition, diatonic_equal=comparison.diatonic_equal,
               chromatic_equal=comparison.chromatic_equal, flags=list(comparison.flags),
               transformations=list(chant.transformations), incipit=extracted.incipit)
    if chant.transformations:
        row["flags"].append("expanded repetition needs scan confirmation")
    if comparison.diatonic_equal and comparison.chromatic_equal is False:
        row["flags"].append("chromatic intervals differ")
    row["status"] = ("melody-agrees" if comparison.diatonic_equal and comparison.chromatic_equal is True
                     and not row["flags"] else "review-normalization" if comparison.diatonic_equal
                     else "differences")
    if not comparison.diatonic_equal and comparison.transposition is not None:
        row["difference_kind"] = difference_kind(ours, chant, comparison.transposition)
    for operation, a1, a2, b1, b2 in comparison.opcodes:
        if operation == "equal":
            continue
        row["discrepancies"].append({"operation": operation, "ours_range": [a1, a2],
                                    "chant_range": [b1, b2],
                                    "ours_context": [_note(n) for n in ours.notes[max(0, a1 - 3):min(len(ours.notes), a2 + 3)]],
                                    "chant_context": [_note(n) for n in chant.notes[max(0, b1 - 3):min(len(chant.notes), b2 + 3)]]})
    context = [n for d in row["discrepancies"][:12] for n in d["ours_context"]]
    if not context:
        context = [_note(n) for n in ours.notes[:8]]
    row["source_excerpt"] = _source_excerpt(text, context)
    row["sample_notes"] = [_note(n) for n in ours.notes[:12]]
    return row


def _copy_media(item: dict, out: Path, local_assets: Path | None) -> None:
    if local_assets is None:
        return
    media = out / "media"
    media.mkdir(parents=True, exist_ok=True)
    wide = out / "renders" / item["hash"] / "wide.svg"
    if not wide.exists():
        wide = local_assets / "typeset/out" / item["hash"] / "wide.svg"
    if wide.exists():
        from pipeline.typeset.svgcheck import check_file as check_svg
        if not check_svg(wide):
            name = f"{item['hash']}-wide.svg"
            shutil.copyfile(wide, media / name)
            item["wide_image"] = f"media/{name}"
    for scan in item.get("scans", []):
        ref = scan["ref"]
        if not re.fullmatch(r"noh[1-8]/\d{4}/\d{3}", ref):
            continue
        base = local_assets / "systems" / Path(ref).parent
        metadata = base / "manifest.json"
        image = base / f"{Path(ref).name}@2x.webp"
        if not metadata.exists() or not image.exists():
            continue
        stored = json.loads(metadata.read_text()).get("systems", [])
        match = next((s for s in stored if s.get("index") == int(Path(ref).name)), None)
        if not match or not str(scan.get("asset", "")).endswith("-" + match["sha256"][:12]):
            continue
        name = ref.replace("/", "-") + "-" + match["sha256"][:12] + ".webp"
        shutil.copyfile(image, media / name)
        scan["image"] = f"media/{name}"


def write_report(report: dict, out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    packets = out / "packets"
    packets.mkdir(exist_ok=True)
    # Old packets are not evidence for the current run. Remove only the files
    # this writer owns, not arbitrary files a reviewer saved next to them.
    for old in packets.glob("case-*.json"):
        old.unlink()
    esc = lambda value: html.escape(str(value), quote=True)
    cards = []
    for number, item in enumerate(report["items"], 1):
        packet_name = f"case-{number:03}.json"
        (packets / packet_name).write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
        flags = "".join(f"<li>{esc(flag)}</li>" for flag in item.get("flags", []))
        differences = []
        for d in item.get("discrepancies", [])[:12]:
            differences.append(f'<pre>{esc(json.dumps(d, ensure_ascii=False, indent=2))}</pre>')
        scans = "".join(f'<figure><figcaption>{esc(s["ref"])}</figcaption>' +
                        (f'<img loading="lazy" src="{esc(s["image"])}" alt="Scanned system">'
                         if s.get("image") else '<p>Local scan image unavailable.</p>') + '</figure>'
                        for s in item.get("scans", []))
        wide = (f'<img loading="lazy" src="{esc(item["wide_image"])}" alt="LilyPond wide render">'
                if item.get("wide_image") else '<p>Local wide render unavailable.</p>')
        cards.append(f'''<details><summary>{number}. {esc(item['file'])} — {esc(item['status'])}</summary>
<p>{esc(item.get('difference_kind', ''))} · {esc(item.get('incipit', ''))} · {esc(item.get('ours_notes', '?'))} / {esc(item.get('chant_notes', '?'))} notes</p>
<p><a href="packets/{packet_name}">Review packet JSON</a> · {esc(item.get('target', ''))}</p>
<ul>{flags}</ul><pre>{esc(item.get('source_excerpt', ''))}</pre>
<div class="scores"><section><h3>Typeset</h3>{wide}</section><section><h3>Matched scan systems</h3>{scans or '<p>No scan span available.</p>'}</section></div>
<h3>Discrepancies (first 12; complete list in JSON)</h3>{''.join(differences) or '<p>No diatonic discrepancy; check any normalization flags above.</p>'}</details>''')
    body = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Chant melody proofreading pilot</title><style>
body{{font:16px system-ui;max-width:1500px;margin:2rem auto;padding:0 1rem;background:#faf9f5;color:#242424}}
details{{background:white;border:1px solid #ddd;border-radius:8px;margin:1rem 0;padding:1rem}}summary{{cursor:pointer;font-weight:600}}
.scores{{display:grid;grid-template-columns:1fr 1fr;gap:1rem}}img{{width:100%;height:auto}}figure{{margin:1rem 0}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f3f0;padding:1rem}}
@media(max-width:800px){{.scores{{grid-template-columns:1fr}}}}</style>
<h1>Chant melody proofreading pilot</h1><p>Melody evidence only. No full-proofreading acknowledgments were changed.</p>
<p>{esc(report['summary'])}</p><p><a href="report.json">Complete report and provenance</a></p>{''.join(cards)}</html>'''
    path = out / "index.html"
    path.write_text(body, encoding="utf-8")
    return path


def audit(limit: int = 30, out: Path = DEFAULT_OUT, files: list[str] | None = None,
          local_assets: Path | None = None) -> dict:
    remaining = inventory()
    if files:
        known = {i["file"]: i for i in remaining}
        unknown = sorted(set(files) - known.keys())
        if unknown:
            raise ValueError("not a remaining matched file: " + ", ".join(unknown))
        selected = [known[f] for f in dict.fromkeys(files)]
    else:
        selected = select_pilot(remaining, limit)
    cache = out / "events"
    cache.mkdir(parents=True, exist_ok=True)
    # Reuse only exact event context keys, copying into this worktree. Never
    # let extraction write into the other agent's cache on a miss.
    if local_assets:
        for item in selected:
            text = (SRC / item["file"]).read_text()
            key = events.cache_key(text, load_pin().version)
            hit = local_assets / "typeset/events" / f"{key}.tsv"
            if hit.exists() and not (cache / hit.name).exists():
                shutil.copyfile(hit, cache / hit.name)
    items = []
    for item in selected:
        result = audit_one(item, cache=cache)
        _copy_media(result, out, local_assets)
        items.append(result)
        print(f"{len(items):>3}/{len(selected)}  {result['status']:>20}  {result['file']}", flush=True)
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    report = {"algorithm": ALGORITHM,
              "algorithm_hash": digest(Path(__file__).read_text() + Path(proof_notes.__file__).read_text()),
              "source_commit": revision, "lilypond": load_pin().version,
              "remaining": len(remaining), "selected": len(items),
              "summary": dict(Counter(i["status"] for i in items)), "items": items}
    report["input_fingerprint"] = digest(json.dumps({
        "algorithm_hash": report["algorithm_hash"], "source_commit": revision,
        "inputs": [{k: row.get(k) for k in ("file", "target", "hash", "source_hash", "gabc_hash", "event_key")}
                   for row in items]}, sort_keys=True))
    write_report(report, out)
    return report
