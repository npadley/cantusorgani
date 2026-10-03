# NOH accompaniment recognition: NOH4 pilot

Date: 2026-10-03
Status: draft for review; engine implementation has not started.

## Purpose and scope

Build a reusable local processor that reads the printed organ accompaniment
from NOH scans and generates editable LilyPond. Begin with NOH4; design the
interfaces to cover missing transcriptions throughout the collection, including
Books 7 and 8. The owner's machine should eventually process batches overnight,
resume after interruption, and produce evidence that existing review automation
can consume.

The owner already has checking of Books 1–3 and 5 and coverage inventory in
progress. Consume those artifacts without duplicating or modifying that work.
An upstream contribution of verified corrections and new transcriptions is
optional Phase 2, after checking the existing books. No publication, upstream
PR, scheduled automation, or bulk run is part of this design stage.

## Existing building blocks

- `pipeline/evaluate.py` and `pipeline/segment.py`: scan cleaning, staff finding,
  system bounding boxes and visual overlays.
- Catalogue part boundaries, source system references, and cached GregoBase GABC.
- Pinned LilyPond 2.26.0, shared NOH house style, rendering and review machinery.
- `pipeline/typeset/listen.ily`: musical events for all score voices, including
  pitches, durations, rests, ties and lyrics. The current event reader reduces
  this to chant data; accompaniment needs a richer reader.
- Active checking work in `codex/chant-proofreading-pilot`: a strict melody
  comparison and hash-aware evidence reports. Its interfaces remain provisional
  until that work is delivered; use an adapter to its versioned JSON artifacts.

The initial checkout inspected contained 192 locally printed NOH4 sections,
186 with cached GABC, and 131 borrowed references. Regenerate the inventory from
the chosen implementation commit rather than treating these counts as fixed.

## Evidence and independence

Keep three inputs separate: source scan, GregoBase melody, and existing LilyPond.
GregoBase validates chant identity and alignment, allowing documented NOH
transpositions and variants. It does not validate alto, tenor or bass.

An existing file becomes accompaniment ground truth only when its full score
has been checked against the scan at the recorded source/render hash. A
catalogue match or melody-only pass is weaker evidence. Unverified files may
provide exploratory examples, but cannot establish accompaniment accuracy.

For benchmark evaluation the recognizer receives the scan and, in the guided
mode, GABC. It must not receive the expected LilyPond accompaniment. The
evaluator reads that independently after prediction. Group related pieces,
shared settings and synthetic variants into the same development/test partition
to prevent leakage. Reserve complete held-out pieces from at least two existing
volumes, selected before tuning; report real scans separately from synthetic
LilyPond renders. Freeze benchmark hashes before each evaluation.

## Processing architecture

1. Input adapter resolves a complete part to scan crops, staff geometry,
   catalogue identity and optional GABC. Borrowed parts point to their actual
   source setting. Similar melodies never imply identical accompaniment.
2. Symbol detection emits noteheads, clefs, accidentals, rests, ties, slurs,
   phrase divisions and, as later profiles require, stems and beams. Every
   detection carries a source bounding box and uncertainty evidence.
3. Musical reconstruction resolves key and accidental scope, staff pitches,
   voices, held-note spans and phrase alignment. Voice crossings are not solved
   solely by vertical ordering. Separate printed note values from inferred
   timing; ambiguous alignment remains an explicit unresolved item.
4. Guided chant alignment preserves repeated attacks and genuine ties and
   records transposition, repeat expansion and edition differences. Missing or
   unsupported GABC selects an explicitly less constrained scan-only mode.
5. Intermediate transcription stores stable part identity, all voices, pitches
   and alterations, onset/duration fractions, printed notation, source locations,
   unresolved alternatives and provenance. LilyPond is generated through the
   existing house style, with no new music composed to fill missing evidence.
6. Validation reads generated LilyPond events, checks musical structure and
   chant alignment, and inspects all four render formats. A scan comparison
   generates localized evidence rather than claiming pixel similarity proves
   musical correctness. Expected accompaniment events are used only by the
   independent benchmark evaluator.
7. Reports expose draft, blocked, melody-checked, accompaniment-checked and
   fully-reviewed evidence separately. A successful compile or confident detector
   never automatically becomes a full-proofreading acknowledgment.

Use conventional Python/image processing for the first detector baseline.
Add a learned detector or selective AI interpretation only if measured errors
justify it. Model calls are optional and have explicit limits; no per-system
AI dependency is assumed for an overnight run.

## Pilot material and measurements

Create a calibration set from independently checked Books 1–3 and 5: examples
of rests, sustained lower voices, accidentals, ties, repeated notes, crossings,
melismas and faint or tilted print. If verified examples do not cover a class,
record that coverage gap and obtain a checked example before claiming support.

NOH4 first targets, selected from the initial catalogue:
- `missa-pro-pace`, communion *Pacem relinquo*, starting `noh4/0247/000`.
- `in-vigilia-unius-apostoli`, communion *Magna est gloria*, starting
  `noh4/0033/004`.
- One complete longer Gradual or Tract, chosen after scan inspection to exercise
  melismatic alignment and held accompaniment. Log its exact systems in the
  pilot manifest before implementation evaluation.

Proofread these complete extracts independently to establish NOH4 references.
Do not assess only visually easy systems or omit an extract's ending.

Measure notehead precision/recall; pitch and accidental errors per voice;
voice assignment, onset/span and tie errors; whole-system correctness;
unresolved coverage; runtime and memory; and correction minutes per system.
Include false acceptance rates and stratify by notation and scan quality.
Deliberately introduce wrong bass/alto pitches, dropped notes and endings,
incorrect accidentals, ties and voice assignments to test the validator. Sample
apparently clean predictions independently; agreement between two dependent
checks is not independent confirmation.

## Overnight runner

Use a finite, explicitly selected batch rather than a recurring scheduler.
Snapshot the input commit and references before running. Checkpoint each system
and part atomically, cache by source/GABC/settings/algorithm hashes, retain logs
and retry counts, and invalidate results when inputs change. Never consume a
changing checkout as a live source of truth.

Support bounded worker count, a stop time, optional model-call budget, maximum
retries and graceful interruption. Independent failures enter a review queue;
systemic failures stop the run. Resume without repeating completed valid work.
Produce a morning summary of completed parts, errors, uncertain passages,
resource usage and paths to the evidence packets. Keep all output local and
unpublished until reviewed. Correction overlays survive regeneration and become
reproducible inputs rather than one-off edits lost on rerun.

First prove this runner on a small batch and test interruption/resume and cache
invalidation. Choose throughput and resource limits from measurements on the
owner's machine. Full NOH4 processing starts only after the pilot demonstrates
useful correction-time savings and reviewable results; recognition coverage
alone is insufficient. No numerical acceptance threshold is claimed before
the baseline is measured, and no unattended result counts as fully proofread.

## Expansion and upstream contribution

The common engine is separated from notation profiles: free chant accompaniment
first, then hymn/metered notation where present, then psalm recitation and tone
endings. Inspect representative Book 7 and 8 scans before finalizing their
profiles, and add held-out examples for each before bulk use. Scan-only mode
must be benchmarked separately from GABC-guided mode.

Keep original upstream names and provenance where possible, and separate
musical corrections from site-specific version, include and layout changes.
New sources remain editable and carry printed source references. Phase 2 may
prepare an upstream-compatible export, correction notes and proofing evidence;
submission remains a later owner decision.

## Next stage

Review this design, then write an implementation plan in separate deliverable
steps: benchmark/input contract, recognition baseline, musical reconstruction,
LilyPond generation/evaluation, and bounded batch runner. Pilot findings decide
whether learned detection is needed. Existing checking work remains independent
and supplies stronger references as it finishes.
