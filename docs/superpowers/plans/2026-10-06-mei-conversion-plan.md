# LilyPond-to-MEI Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce faithfully encoded Kyrie IX MEI, a reproducible catalogue audit, and evidence that supports independent approval.

**Architecture:** Execute trusted sources with the existing pinned, isolated LilyPond runner. Extract a full exact intermediate representation, encode MEI, and independently compare normalized generated events to the extracted source. Keep conversion approval separate from transcription proofreading and publish only through Plan C.

**Tech Stack:** Python 3.12+, LilyPond pinned by `data/typeset/lilypond.yml`, pytest, exact `fractions.Fraction`, pinned MEI schema, a version-pinned XML validation dependency selected in A3.

**Spec:** [Design](../specs/2026-10-06-export-layout-editor-design.md), especially §6 and the conversion gate. [Coordination contracts and handoffs](2026-10-06-export-layout-implementation-plan.md).

## Global Constraints

- “Do not depend on the experimental converter's line-number voice selection or its lyric-to-slur heuristic.”
- “Do not collapse repeated attacks into ties or simplify simultaneous voices for convenience.”
- “Every unsupported musical feature blocks approval.”
- “No generic ‘best effort’ success state.”
- “Do not manually edit generated MEI as a permanent fix; fixes belong in source corrections or versioned conversion rules.”
- States are `unsupported`, `failed`, `needs-review`, and `approved`; any relevant input/version change invalidates approval.
- Preserve matching's existing `pipeline/typeset/events.py` behavior and existing source security rules.
- No MusicXML production pipeline or Volpiano conversion is included.

## Review Focus

1. Anonymous, renamed, or nested simultaneous voices: A2 must discover all voices without source-line assumptions.
2. Melismas, repeated syllables, blank lyric tokens, and entry markers: A2/A4 compare actual associations, not counts alone.
3. Sustained accompaniment crossing a new break: A3/A4 normalize tied fragments without creating an attack or losing duration.
4. Includes, house functions, or renderer upgrades changing meaning: A1/A5 invalidate dependent artifacts and preserve localized diagnostics.
5. Conversion approval mistaken for source proofreading: A6 records separate states and never grants catalogue matching.

---

## File ownership

| Files | Responsibility |
| --- | --- |
| `pipeline/typeset/mei/__init__.py`, `model.py`, `diagnostics.py` | Public conversion types, rational serialization, diagnostic vocabulary |
| `pipeline/typeset/mei/audit.py` | Dependency closure, source/target inventory, feature families |
| `pipeline/typeset/mei/extract.py`, `listen.ily` | Resolved full-score extraction with source provenance |
| `pipeline/typeset/mei/encode.py`, `features.py`, `schema.py` | Explicit feature mappings, deterministic MEI, schema validation |
| `pipeline/typeset/mei/normalize.py`, `validate.py` | Independent musical normalization and semantic comparison |
| `pipeline/typeset/mei/evidence.py`, `review.py`, `manifest.py`, `cli.py` | Review packets, approval binding, exportable manifest contract |
| `data/typeset/mei/schemas/`, `profiles/`, `reviews/` | Pinned schemas/profiles and small tracked decisions |
| `tests/fixtures/mei/`, `tests/test_mei_*.py` | Minimal sources, expected semantic data, mutation tests |
| `pipeline/cli.py`, `pyproject.toml`, `uv.lock` | Coordinator-owned command registration/dependency changes |

Generated audit/conversion/render/evidence files go under `build/typeset/mei/`, not tracked source directories. Fixtures contain only small evidence needed for deterministic tests. Existing `render.py`, `listen.ily`, and `events.py` remain consumers of the original matching pipeline; the new listener is separate unless a shared primitive is demonstrably necessary.

## A1. Catalogue audit and exact data contracts

**Dependencies:** None. **Owner:** economical Python implementer; coordinator registers CLI.

**Files:** Create `model.py`, `diagnostics.py`, `audit.py`, `cli.py`, IR JSON schema, `tests/test_mei_audit.py`, `tests/test_mei_model.py`, and fixture include families. Modify `pipeline/cli.py` only for dispatch.

**Interfaces:** `audit_sources(root: Path, targets: list[dict], include_dir: Path) -> AuditReport`; `ScoreIR.to_dict() -> dict`; `ScoreIR.from_dict(value: dict) -> ScoreIR`; `Diagnostic(code, severity, source_location, event_ids, details)`. `AuditReport` contains source records, dependency closures/digests, matched target references, discovered/unknown feature families, compilation status, and exceptions. CLI: `uv run noh typeset-mei-audit --out build/typeset/mei/audit.json`.

- [ ] Write failing tests named `test_dependency_change_changes_digest`, `test_empty_source_is_not_failed_conversion`, and `test_unknown_include_reports_location`. Assert a changed nested include changes the digest; an empty transcription is excluded from conversion denominators; untrusted/unknown dependencies are diagnosed without execution. Add rational round-trip assertions `Fraction(14,16) -> "7/8"` and reject float timing.

```python
assert before.sources[0].dependency_digest != after.sources[0].dependency_digest
assert empty_record.state == "absent"
assert unknown.diagnostics[0].source_location.filename == "score.ly"
```

Here `absent` is an audit classification, not a new conversion state. Fixture builders and normalized test projections belong in the test module.
- [ ] Run `uv run pytest -q tests/test_mei_audit.py tests/test_mei_model.py`; expect import/assertion failures for the new behavior.
- [ ] Implement closure traversal with cycle handling and allowed-include policy; inventory all nonempty sources and existing target associations. Text inspection is only a candidate feature scan: mark unresolved constructs unknown until compiler extraction confirms them. Preserve filename/line/column in diagnostics. Record tool/config/include bytes in hashes.
- [ ] Run the tests; expect PASS. Run the audit against the actual repository and save a reproducible feature-family/count report. Do not replace unknowns with invented coverage estimates. Confirm existing source-check tests still pass: `uv run pytest -q tests/test_typeset_source_check.py`.
- [ ] Review the contract against the coordination document, then commit only A1-owned files with `feat: audit MEI conversion sources and define exact IR`.

**Handoff:** Audit JSON plus a human-readable summary of actual source count, unknown families, dependency clusters, and proposed stratified pilot. A reviewer can reject the pilot selection independently of the model code.

## A2. Full resolved extraction and lyric anchoring

**Dependencies:** A1. **Owner:** music-data implementer; independent semantic reviewer.

**Files:** Create `extract.py`, `listen.ily`, `tests/test_mei_extract.py`, `tests/fixtures/mei/extraction/`. Add extractor command in `mei/cli.py`.

**Interfaces:** `extract_score(source: Path, *, runner: LilyPondRunnerAdapter, profile: ConversionProfile) -> ExtractionResult`, where result contains `ScoreIR | None`, diagnostics, compiler version, dependency digest, and raw evidence path. Define `LilyPondRunnerAdapter` locally around existing `pipeline/typeset/lilypond.py` APIs; do not assume a class already exists. CLI: `typeset-mei-extract SOURCE --out DIRECTORY`.

- [ ] Write failing compiler-backed tests for renamed/anonymous voices, two scores, unequal rests/skips, relative pitches, duration inheritance/scaling, explicit accidentals versus sounding pitch, ties versus repeated attacks, and source filenames through includes. Assert staff/layer/event identity and reduced rational values, not only MIDI output.
- [ ] Add lyric fixtures with melisma, repeated text, stanza markers, blank tokens, accented text, and lyric contexts linked to named voices. Assert `lyric.anchorEventId` identifies the intended event even when accompaniment shares its timestamp. An entry marker is preserved separately from lyric text.

```python
assert {layer.name for layer in ir.layers} == {"chant", "alto", "tenor", "bass"}
assert syllable.anchor_event_id == chant_attack.id
assert accompaniment_attack.onset == chant_attack.onset
assert syllable.anchor_event_id != accompaniment_attack.id
```
- [ ] Run `uv run pytest -q tests/test_mei_extract.py -m lilypond`; expect new extraction failures with the pinned compiler available. A skip is not a completed task.
- [ ] Implement a reviewed resolved listener/compiler-tree adapter. Capture all properties specified by `ScoreIR`. If event listeners cannot provide an association/property, add a compiler-tree extraction for that property with a minimal fixture and explicit provenance. Keep Scheme execution inside the existing sandbox. No selecting voices by source lines, matching lyrics to slur guesses, or floating point arithmetic.
- [ ] Run extraction tests and `uv run pytest -q tests/test_typeset_lilypond.py tests/test_typeset_source_check.py`. Extract `data/typeset/src/vol-5/missa-ix/kyrie_IX.ly`; compare all four voices and the experiment's 358 pitched events, five skips, and 60 printed syllables as baseline checks, then independently verify all entries/divisions/anchors the experiment omitted. Counts alone do not establish fidelity.
- [ ] Commit A2 files with `feat: extract exact polyphonic LilyPond semantics for MEI` after independent review.

**Handoff:** IR/raw extraction and fixture generation instructions. Preserve experiment provenance but remove absolute temporary paths; no dependency on chat storage or `/private/tmp` tools.

## A3. Deterministic unmetered MEI and safe boundaries

**Dependencies:** A2 and audited feature inventory. **Owner:** music-data implementer.

**Files:** Create `encode.py`, `features.py`, `schema.py`, `data/typeset/mei/profiles/accompaniment-v1.json`, pinned MEI schema bundle/metadata, `tests/test_mei_encode.py`, `tests/test_mei_schema.py`, encoding fixtures. Coordinator updates Python dependencies if required.

**Interfaces:** `encode_score(ir: ScoreIR, profile: ConversionProfile) -> EncodedScore`; `validate_schema(xml: bytes, schema: SchemaBundle) -> list[Diagnostic]`. `EncodedScore` contains XML, artifact digest, boundary manifest, feature decisions, and diagnostics. Profile explicitly versions every supported house mapping. CLI: `typeset-mei-convert SOURCE --out DIRECTORY` invokes extraction then encoding; no approval side effect.

- [ ] Write failing fixtures for exact scaled durations, simultaneous layers, above-staff anchored lyrics, hidden stems, noteheads, accidental display, ties/slurs, division variants, entry markers, `quil`, and cross-staff relationships discovered by A1. A feature not implemented produces `UNSUPPORTED_FEATURE` with source location and blocks eligibility. Do not claim support solely because an element is emitted.
- [ ] Add a sustained-event fixture: splitting `7/8` into `3/8 + 1/2` retains one attack and normalized `7/8` sustain. Assert a page boundary is unavailable if its required split cannot preserve ties/lyrics/cross-staff meaning. Assert synchronization containers have no invented meter or visible barline.

```python
assert sum(fragment.duration for fragment in fragments) == Fraction(7, 8)
assert sum(fragment.is_attack for fragment in fragments) == 1
assert unsupported_boundary.safe is False
assert schema_diagnostics == []
```
- [ ] Run `uv run pytest -q tests/test_mei_encode.py tests/test_mei_schema.py`; expect failures.
- [ ] Implement stable IDs and explicit staff/layer definitions in conventional unmetered MEI. Boundary timing must be exact and shared by all layers; safe interior boundaries use provenance-linked tied fragments only where supported. Map finalis/minima/other audited divisions individually. Pin a schema distribution and its hash; choose an XML validator that actually supports that schema, disable external entity/network resolution, and vendor all required schema dependencies. Never substitute “well-formed XML” for schema validation.
- [ ] Run tests and schema-validate Kyrie IX. Render it with pinned Verovio 6.3.0 in a reproducible local harness; record schema/renderer capability differences and emitted diagnostic codes. Unknown features remain blockers even if the page looks plausible.
- [ ] Commit A3 files with `feat: encode validated unmetered MEI with safe break anchors` after review.

**Handoff:** Reproducible pilot MEI and versioned profile. This unapproved artifact may support B2's private fidelity proof, but cannot enter a public manifest.

## A4. Independent semantic comparison and mutation checks

**Dependencies:** A3. **Owner:** validation implementer distinct from encoding reviewer when practical.

**Files:** Create `normalize.py`, `validate.py`, `tests/test_mei_validate.py`, mutation fixtures.

**Interfaces:** `normalize_ir(ir: ScoreIR) -> NormalizedScore`; `normalize_mei(xml: bytes, provenance: dict) -> NormalizedScore`; `compare_scores(source: NormalizedScore, converted: NormalizedScore) -> ValidationReport`. CLI: `typeset-mei-validate DIRECTORY`. Reports have schema result, localized semantic differences, feature eligibility, hashes, and tool versions.

- [ ] Write failing mutation tests that remove a voice; change a pitch; move an onset by `1/64`; shorten a final sustain; replace a repeated attack with a tied continuation; move a lyric anchor without changing text/count; drop an ending, division, entry marker, tie, slur, or accidental-display requirement. Assert exact diagnostic code and affected source/event IDs for each mutation.
- [ ] Add a valid tied-split equivalence test and invalid fragment-overlap/gap tests. Assert every staff/layer's duration and event sequence, including rests/skips, plus all lyric/span associations. A converted event cannot be ignored merely because it is absent from provenance.

```python
assert compare_scores(source, valid_tied_split).semantic_differences == []
assert "LYRIC_ANCHOR_MISMATCH" in codes(compare_scores(source, moved_lyric))
assert "ATTACK_MISMATCH" in codes(compare_scores(source, collapsed_attack))
```
- [ ] Run `uv run pytest -q tests/test_mei_validate.py`; expect failures.
- [ ] Implement an independent MEI reader for validation rather than replaying encoder output objects. Normalize only proven equivalent sustain splits, never attacks or notation semantics. Validate XML and generated semantics first; additionally extract renderer-visible event identities/timing where exposed and diagnose missing rendered content. MIDI is supplementary evidence, not the oracle.
- [ ] Run all `tests/test_mei_*.py` currently present and Kyrie validation. Expected: original derivative has zero unexplained semantic differences; each mutation fails. If renderer data cannot expose a property, record that limitation and assign its visual check to A5 instead of reporting it verified.
- [ ] Commit A4 files with `test: detect localized musical losses in MEI conversion` after independent review of the oracle.

## A5. Evidence packets and revision-bound visual approval

**Dependencies:** A4; B2 supplies final font/PDF checks before final pilot approval.

**Files:** Create `evidence.py`, `review.py`, `tests/test_mei_review.py`; add evidence/review CLI commands; create small decision schema under `data/typeset/mei/schemas/`. Evidence outputs remain under build directories.

**Interfaces:** `build_evidence(record: ConversionRecord, target: dict | None, matrix: list[LayoutCase]) -> EvidencePacket`; `apply_review(record: ConversionRecord, decision: ReviewDecision) -> ConversionRecord`; `approval_is_current(record: ConversionRecord, inputs: ConversionInputs) -> bool`. CLI: `typeset-mei-evidence DIRECTORY`; `typeset-mei-review DIRECTORY --decision DECISION_JSON`. Review files contain named reviewer, timestamp, artifact/input hashes, matrix results, accepted engraving differences, and explicit approve/reject decision.

- [ ] Write failing tests: unsupported music cannot be approved; a failed schema/semantic check cannot be approved; missing required matrix cases cannot be approved; changing any source/include/extractor/converter/profile/schema/renderer/font dependency invalidates approval; a changed artifact cannot reuse a prior decision. Approval does not set existing proofreading flags.

```python
assert approval_is_current(approved_record, unchanged_inputs)
assert not approval_is_current(approved_record, changed_include_inputs)
with pytest.raises(ReviewBlocked, match="UNSUPPORTED_FEATURE"):
    apply_review(unsupported_record, approve_decision)
```

Define `ReviewBlocked` in `review.py` and preserve its diagnostic codes for CLI errors.
- [ ] Run `uv run pytest -q tests/test_mei_review.py`; expect failures.
- [ ] Implement side-by-side LilyPond/MEI/scan context, source-linked diagnostics, and geometry checks for overflow/clipping/suspicious collisions. Reuse existing scan-context lookup rather than making new catalogue matches. Geometry findings flag review, never auto-approve visual fidelity. Render representative cases: six paper/orientation combinations at medium staff under both line policies, Letter/large, both music/text font choices, and cap two. Clearly label unavailable font proof until B2 resolves it.
- [ ] Run tests; independently inspect Kyrie packet for each voice, lyric/entry, division, cross-staff feature, final system, and stress layout. Record exact accepted engraving differences; do not accept omitted musical content. A designated maintainer signs final approval after the whole matrix is complete.
- [ ] Commit code/schema with `feat: generate revision-bound MEI review evidence`; commit tracked decisions only after authorized approval, separately from code.

## A6. Artifact/manifest contract and CLI integration

**Dependencies:** A5. **Owner:** coordinator or bounded integration implementer.

**Files:** Create `manifest.py`, `tests/test_mei_manifest.py`, `tests/test_mei_cli.py`; complete `mei/cli.py` dispatch via `pipeline/cli.py`; document commands in `docs/TYPESETTING.md`. No public upload in this task.

**Interfaces:** `build_manifest(records: list[ConversionRecord], matched_parts: list[dict]) -> ConversionManifest`; `verify_artifact(record: ConversionRecord, directory: Path) -> list[Diagnostic]`. Manifest contains only current approved records, original target/render-hash association, immutable artifact paths, revision, versions, safe boundaries, and capability flags. CLI: `typeset-mei-manifest --records DIRECTORY --out FILE`.

- [ ] Write failing tests for approved-but-stale records, unmatched converted files, target render-hash mismatches, corrupted artifacts, unsupported capabilities, missing assets, and valid approved input. Assert the first five cases are excluded or fail explicitly; existing proofreading state is unchanged.

```python
assert build_manifest([stale_record], matched_parts).parts == []
assert build_manifest([unmatched_record], matched_parts).parts == []
assert verify_artifact(approved_record, corrupt_directory)[0].code == "HASH_MISMATCH"
```
- [ ] Run `uv run pytest -q tests/test_mei_manifest.py tests/test_mei_cli.py`; expect failures.
- [ ] Implement the manifest builder using current matching/effective-part rules; conversion never establishes a match. Reject unsafe paths and verify hashes. Register command dispatch without changing existing commands' defaults. Produce a private approved fixture manifest for B3/B9 tests, clearly separated from public build inputs.
- [ ] Run the tests plus `uv run pytest -q tests/test_cli.py tests/test_cli_commands.py` and `uv run noh typeset-check`. Expected: existing commands and matching remain operational.
- [ ] Commit with `feat: expose approved MEI artifact contracts without changing matching`.

## Completion packet

Return accepted commits, audit counts/feature families, pilot source/dependency digest, schema/profile/extractor versions, Kyrie semantic report, mutation-test evidence, visual matrix and unresolved differences, manifest fixture, and reviewer recommendation. Explicitly distinguish `needs-review` from final maintainer approval. Plan B may consume fixtures; Plan C publishes only current approved assets.
