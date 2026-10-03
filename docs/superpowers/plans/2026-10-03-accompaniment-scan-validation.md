# Accompaniment Scan Validation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Do not start until the owner reviews this plan. Use test-driven-development and a fresh whole-branch review.

**Goal:** Compare existing LilyPond alto, tenor and bass against independently read source scans, producing reusable discrepancy evidence and explicitly scoped validation results.

**Architecture:** Extract expected score events through LilyPond, but read scan symbols independently. Align the two streams only after scan detection; generate local JSON and HTML with overlays and conservative per-property verdicts. Unresolved symbols, voice assignments or duration interpretations prevent full accompaniment acceptance.

**Tech Stack:** Existing Python, NumPy, OpenCV, PyMuPDF, pinned LilyPond 2.26.0; no external model or service required for the baseline.

**Spec:** docs/superpowers/specs/2026-10-03-noh4-recognition-pilot-design.md

## Global Constraints

- Implement only the scan-validation component of the approved pilot design. Recognition-to-LilyPond and an overnight scheduling mechanism are later deliverables.
- Work in the attached isolated worktree on `codex/noh4-recognition-pilot`.
- Preserve catalogue matches and source files; never auto-acknowledge full proofreading or publish results.
- GABC verifies chant alignment, not accompaniment. Prior melody-only passes are never accompaniment ground truth.
- Cache and review reuse require source, scan, reference, algorithm and settings hashes to agree.
- Keep independent scan observations distinct from expected LilyPond events; expected pitches must not guide detection or erase unexplained scan ink.
- Compare real scans separately from synthetic fixtures. Related settings belong in the same calibration/evaluation partition.

## Review Focus

- Extra scan notes and extra typeset notes must both be reported; matching a subset cannot pass.
- A swapped tenor/bass assignment can preserve chord pitches but must not pass voice validation.
- Equal pitches with wrong accidentals, onset, duration or tie state must remain discrepancies or unresolved.
- Faint printing, overlapping heads and ambiguous clef/key/accidental scope must abstain rather than produce a clean result.
- A changed scan, source or reviewer evidence invalidates previous acceptance and cached outputs.

## Files and boundaries

- `pipeline/typeset/score_events.py`: all-voice expected musical event extraction.
- `pipeline/typeset/scan_observations.py`: independent scan observations and geometry, plus reviewed observation input.
- `pipeline/typeset/accompaniment_compare.py`: complete alignment and per-property verdicts.
- `pipeline/typeset/accompaniment_audit.py`: catalogue inputs, provenance, local reports and cache.
- `pipeline/cli.py`: `typeset-accompaniment-check` command.
- Corresponding `tests/test_typeset_*.py` files and reviewed scan fixture annotations.
- `docs/ACCOMPANIMENT-VALIDATION.md`: use, evidence states, benchmark results and limitations.

### Task 1: Extract expected accompaniment events without changing the melody audit

**Interfaces:** `read_score(path: Path) -> ScoreEvidence`; `parse_score(tsv: str) -> ScoreEvidence`.
`ScoreEvidence` contains voice-tagged note/rest/skip events, exact fractional onset and duration, pitch spelling and alteration, written duration, tie information, source origin, key/clef context and unsupported flags. Instrument anonymous voices through a trusted wrapper with stable names; never infer tenor/bass identity solely from their pitch.

- [ ] Write failing tests in `tests/test_typeset_score_events.py` for four named voices, rests vs spacers, fractional durations, enharmonic spellings, valid and invalid ties, malformed logs and simultaneous events.
- [ ] Run that file and confirm failure because the new interfaces are absent.
- [ ] Implement the richer reader using the existing safe source check, runner and listener. Extend the trusted listener for missing clef/key or tie-location information if needed; include its bytes in the cache key.
- [ ] Render a real imported score with the pinned binary; assert emitted pitches, durations and voice identities against a small independently specified passage. Ensure existing chant-event tests remain green.
- [ ] Run the new file and existing event/matcher tests, then commit.

### Task 2: Read scan evidence independently and expose unresolved notation

**Interfaces:** `observe_system(image: np.ndarray, settings: ScanSettings) -> ScanEvidence`; `load_reviewed_observations(path: Path, scan_hash: str) -> ScanEvidence`.
`ScanEvidence` contains original-coordinate boxes, staff geometry, clef/key readings, noteheads and alterations, possible voice assignments, rest/tie observations, ambiguous alternatives and unclassified regions. Observations include whether they are machine candidates or independently reviewed annotations. Coordinates record the cleaning transform.

- [ ] Build a small manually annotated real-scan fixture set from Books 1–3 and 5, with provenance and verification scope recorded. Include NOH4 `noh4/0247/000` as an evaluation example; do not invent its accompaniment ground truth from GABC.
- [ ] Write failing tests for open/filled heads, line and space positions, ledger lines, accidental glyphs, two adjacent/overlapping heads, crossed voices, faint print, missing clefs and empty scans. An unsupported case must retain flags instead of becoming clean.
- [ ] Confirm failures, then implement a baseline using existing cleaning and staff geometry plus scale-normalized candidate detection. Freeze calibration settings after measuring real annotated crops. The detector takes no expected score argument.
- [ ] Implement reviewed annotation loading with schema checks and exact scan-hash guards. This supplies reliable observations while automatic duration and voice reading remain incomplete.
- [ ] Inspect overlays on every real fixture. Evaluate held-out pieces and report missed/extra heads and uncertain regions; synthetic fixtures only test geometry and failure behavior.
- [ ] Run the new tests and segmentation regression suite, then commit.

### Task 3: Compare complete evidence and make acceptance scope explicit

**Interfaces:** `compare_accompaniment(score: ScoreEvidence, scan: ScanEvidence) -> ComparisonEvidence`.
Compare every accompanying event and detected scan symbol. Store separate voice, pitch/alteration, onset/span, rest, tie and completeness verdicts: `agrees`, `differs`, `unresolved`, `not-assessed`. Overall result is `discrepancy` if any property differs, otherwise `needs-review` if any required property is unresolved/not assessed, otherwise `agrees`. An overall agreement remains evidence, not a proofreading acknowledgment.

- [ ] Write failing tests for wrong alto/bass pitch, extra/missing heads, an omitted ending, tenor/bass swap, wrong accidental, missing rest, wrong held-note span and missing tie. All must be discrepancies when independently observed or unresolved when the scan cannot support a judgment.
- [ ] Add tests proving that clean pitch-only observations cannot establish complete accompaniment agreement, and that equal chord pitch sets cannot hide swapped voices.
- [ ] Confirm failures, implement complete bidirectional alignment anchored to independently observed scan phrases/chant geometry, and retain ambiguity rather than selecting the alignment most favorable to the typeset.
- [ ] Attach each discrepancy to expected source origins and scan boxes. Do not claim pixel-image similarity establishes musical equality.
- [ ] Run the comparison and evidence suites, then commit.

### Task 4: Local audit command, reports and benchmark handoff

**Interfaces:** `audit(files: list[str], out: Path, scan_root: Path, annotations: Path | None = None) -> AuditSummary`.
CLI: `noh typeset-accompaniment-check --file <relative-source.ly> --scan-root <local-scans> --out <directory>`; repeated `--file` accepts an explicit bounded batch. `--annotations` supplies independently reviewed observations. Do not depend on the other agent's provisional CLI; consume its versioned melody report through an adapter when available.

- [ ] Write failing tests for missing assets, broken sources, unknown/unsafe filenames, stale annotations, stale cache entries, escaped HTML and isolated per-file failures.
- [ ] Confirm failures, then implement source-system resolution, atomic hash-keyed results and local `report.json`/`index.html` with scan overlays, expected events, discrepancies and review requirements. No network model calls, source writes, corrections or external publication.
- [ ] Add evidence export fields for target, exact scan references, source/render/GABC hashes where available, algorithm/settings identity, validation scope and reviewer provenance. Missing GABC does not prevent independent accompaniment inspection.
- [ ] Run on a complete existing accompanied extract; manually verify the report against the scan and demonstrate deliberate wrong alto, tenor and bass notes. Preserve the original source and run mutations in scratch files only.
- [ ] Document measured fixture performance and supported properties. If automatic observations are incomplete, the delivered report must say so and support reviewed annotations; never describe it as a fully proven recognition engine.
- [ ] Run Python CI tests and lint; run real-source/LilyPond tests using locally available dependencies. Obtain a fresh whole-branch review, fix substantive findings, and commit code/docs.

## Completion and next milestone

This deliverable is useful when an editor can run a local audit of an existing
matched score, locate accompanying-voice discrepancies against its actual scan,
and export reproducible evidence. Full accompaniment ground truth requires all
required properties to have independently checked scan evidence; melody-only
or notehead-only agreement does not qualify.

The resulting detector and comparison artifacts can feed the NOH4 recognition
pilot. Recognition-generated NOH4 scores will need an independent validator or
reviewed observations: running the same detector twice does not create a second
source of confirmation. Later, the overnight runner can execute these bounded
audits and queue unresolved cases.
