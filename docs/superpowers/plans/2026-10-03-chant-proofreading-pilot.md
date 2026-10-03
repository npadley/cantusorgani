# Chant Proofreading Pilot Implementation Plan

> For agentic workers: use superpowers:executing-plans for native implementation with one independent final review. Small agents review pilot evidence; do not create an implementer agent per file.

**Goal:** Reduce manual chant proofreading with a strict, deterministic melody audit and targeted evidence packets.

**Architecture:** Reuse pinned LilyPond event extraction and catalogue/GABC resolution. Add a conservative note-level comparator and local JSON/HTML reports. Run a reproducible stratified 30-file pilot, then assess clean cases and discrepancies with compact read-only agent contexts.

**Tech Stack:** Python, pytest, existing LilyPond logger, local HTML.

**Spec:** docs/superpowers/specs/2026-10-03-chant-proofreading-pilot-design.md

## Global Constraints

Work only in this isolated worktree. Never auto-acknowledge full proofreading or change source/catalogue corrections. Full sequence checks preserve repeated attacks; supported transformations are recorded. Missing or ambiguous evidence cannot pass. Inputs and algorithm are fingerprinted. No new runtime dependencies or external writes.

## Review Focus

Wrong notes hidden by an old score of 1.000; compressed strophas mistaken for one attack; wrong accidental scope; multiple simultaneous chant voices/ties; stale hashes and incomplete tails. Tests cover these input classes.

### Task 1: Rich notes and strict alignment

Files: create pipeline/typeset/proof_notes.py and tests/test_typeset_proof_notes.py.
Interfaces: read_events(tsv, inserted_after) -> NoteSequence; read_gabc(gabc, expand=False) -> NoteSequence; compare_notes(ours, chant) -> Comparison. Note includes step, alteration, origin, lyric, phrase. Comparison includes complete diatonic/chromatic agreement, transposition, opcodes, flags.

- [ ] Write and run failing tests for exact transposition, inserted/deleted/changed notes, repeated attacks, ties, accidental markers, compressed strophas, malformed GABC and source origins.
- [ ] Implement rich readers and conservative alignment; keep old matcher unchanged.
- [ ] Verify the tests and the existing matcher suite; commit.

### Task 2: Remaining inventory, pilot and reports

Files: create pipeline/typeset/proofread.py and tests/test_typeset_proofread.py; extend pipeline/cli.py and docs/TYPESETTING.md.
Interfaces: inventory() -> list[dict]; select_pilot(items, limit) -> list[dict]; audit(limit, out, files=None) -> dict; write_report(report, out) -> Path. CLI: noh typeset-proofread --limit 30 --out build/typeset/proofread; --limit 0 audits all remaining; --file selects exact known remaining filenames.

- [ ] Write and run failing tests for hash-aware inventory, stratified deterministic selection, missing evidence, full-tail discrepancies and escaped report content.
- [ ] Implement source validation, existing event-cache reuse, note alignment, provenance and JSON/HTML packets with scan-system context.
- [ ] Verify targeted suites and documented CLI; commit.

### Task 3: Pilot calibration and handoff

Files: create docs/CHANT-PROOFREADING-PILOT.md; generated artifacts stay under ignored build/.

- [ ] Run 30-file pilot on the captured branch; verify deliberately changed/omitted/inserted pitches and repetitions are flagged.
- [ ] Assign compact clean/discrepant packets to small read-only agents. Distinguish machine agreement from scan-confirmed correctness; record uncertainty and actual results.
- [ ] Run Python CI suite and lint; obtain one whole-change review, fix substantive findings and record evidence.
- [ ] Commit code/docs on codex/chant-proofreading-pilot, retain isolated worktree and report next batch instructions. No merge or publication.
