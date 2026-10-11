"""Which approved conversions have gone stale, and why (card C5, problem (a)).

An approval is bound to ``ConversionInputs``. When any of those change, ``manifest.build_manifest``
silently drops the conversion and the piece's Customize button disappears. ``stale_entries`` reports
each approved record whose current inputs (``manifest.current_inputs_from_files``, the single
definition) no longer match the signed ones, field by field, and whether the site's render hash for
its target has moved on. Read-only: nothing here converts, reviews or publishes.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from pipeline.typeset.mei.model import ConversionInputs, ConversionRecord
from pipeline.typeset.mei.review import approval_is_current

#: ConversionInputs field -> the short reason a reader of the report sees.
FIELD_REASONS: dict[str, str] = {
    "source_sha256": "source",
    "include_sha256": "include",
    "lilypond_version": "lilypond",
    "extractor_version": "extractor",
    "converter_version": "converter",
    "profile_id": "profile",
    "profile_sha256": "profile",
    "schema_sha256": "schema",
    "verovio_version": "verovio",
    "font_digest": "font",
}


@dataclass(frozen=True)
class StaleReason:
    field: str       # a ConversionInputs field, "render_hash" or "review.inputs_digest"
    reason: str      # source / include / converter / extractor / profile / schema / lilypond / verovio / font /
                     # render_hash / approval
    recorded: str
    current: str


@dataclass(frozen=True)
class StaleEntry:
    source_path: str
    target: str | None
    render_hash: str | None
    artifact_sha256: str | None
    reasons: tuple[StaleReason, ...]


def stale_entries(
    records: Sequence[ConversionRecord],
    current_inputs: Callable[[ConversionRecord], ConversionInputs],
    matched_parts: Sequence[Mapping[str, str]] | None = None,
) -> list[StaleEntry]:
    """Approved records that ``build_manifest`` would drop for a stale approval or a moved render hash.

    ``matched_parts`` is ``data/typeset/manifest.json``'s ``parts``; when given, a record whose
    ``target`` has no part with its ``render_hash`` is reported too (the source was corrected)."""
    hashes: dict[str, set[str]] = {}
    for part in matched_parts or ():
        hashes.setdefault(part["target"], set()).add(part["hash"])
    found: list[StaleEntry] = []
    for record in records:
        if record.state != "approved":
            continue
        now = current_inputs(record)
        reasons: list[StaleReason] = []
        for name, label in FIELD_REASONS.items():
            recorded, current = getattr(record.inputs, name), getattr(now, name)
            if recorded != current:
                reasons.append(StaleReason(name, label, str(recorded), str(current)))
        if not reasons and not approval_is_current(record, now):
            digest = record.review.inputs_digest if record.review else "none"
            reasons.append(StaleReason("review.inputs_digest", "approval", digest, now.digest()))
        if matched_parts is not None and record.target is not None:
            known = hashes.get(record.target)
            if known is None or record.render_hash not in known:
                current_hash = "absent" if not known else min(known)
                reasons.append(StaleReason("render_hash", "render_hash", str(record.render_hash), current_hash))
        if reasons:
            found.append(
                StaleEntry(record.source_path, record.target, record.render_hash, record.artifact_sha256, tuple(reasons))
            )
    return found


def report_dict(
    entries: Sequence[StaleEntry], checked: int, record_files: Mapping[str, str] | None = None
) -> dict[str, object]:
    """The ``--json`` shape: ``{"checked": N, "stale": [{sourcePath, record, target, renderHash, artifactSha256, reasons}]}``."""
    return {
        "checked": checked,
        "stale": [
            {
                "sourcePath": e.source_path, "record": (record_files or {}).get(e.source_path), "target": e.target,
                "renderHash": e.render_hash,
                "artifactSha256": e.artifact_sha256, "reasons": [dataclasses.asdict(r) for r in e.reasons],
            }
            for e in entries
        ],
    }


def report_table(entries: Sequence[StaleEntry], checked: int) -> str:
    """A readable table: one row per stale record, reasons joined, then a total."""
    if not entries:
        return f"none stale: {checked} approved conversion(s) checked"
    rows = [("target", "reasons", "source")]
    for e in entries:
        rows.append((e.target or "(no target)", ", ".join(dict.fromkeys(r.reason for r in e.reasons)), e.source_path))
    widths = [max(len(row[i]) for row in rows) for i in range(3)]
    lines = ["  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip() for row in rows]
    lines.insert(1, "  ".join("-" * w for w in widths))
    lines.append(f"{len(entries)} of {checked} approved conversion(s) stale")
    return "\n".join(lines)
