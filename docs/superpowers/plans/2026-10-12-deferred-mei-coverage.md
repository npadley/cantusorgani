# Deferred MEI coverage implementation plan

> **For agentic workers:** Use superpowers:executing-plans for implementation and targeted parallel audits.

**Goal:** Recover publishable deferred scores under the user-approved correction and matching policy.

**Architecture:** Keep original NOH scans and independent semantic validation authoritative. Repair narrowly reproduced converter/layout defects and verified transcription errors; then rejudge once after combined changes. Promote matches only with identity/melody evidence and no conflicting accepted assignment.

**Tech Stack:** LilyPond 2.26, Python MEI pipeline, Verovio 6.3.

**Spec:** User-approved policy: original printed NOH scans control faithful corrections; promote verified matches automatically; return ambiguous notation and genuine melody differences to the user. Baseline: ../reviews/2026-10-12-export-p5/deferred-coverage.md.

## Global constraints

- Compiler concurrency at most two. Cheap agents handle read-only matching and triage.
- Preserve music unless a correction is verified against the original scan.
- Generate record digests through the pipeline and retain independent approval gates.
- Lyric collisions remain nonblocking warnings.
- Preserve the existing 708 published approvals through generated carry-forward/rejudging.
- Code PRs require user merge or explicit code-PR merge authorization.

## Review focus

- Zero-duration engraving anchors must not become sounding grace notes or invalid tuplets.
- Visible zero-duration notes/rests need scan verification.
- Printed breaks/divisions cannot truncate events or change normalized timing.
- Proposed matches may conflict with editor-assigned settings.
- Keep tie endpoint and clipping gates while distinguishing valid edge fragments.

## Tasks

- [x] Audit all matching/source/layout cases and create an editorial decision queue.
- [x] Reproduce zero-duration voice-line anchor failures; test a representation supported by pinned Verovio before implementation.
- [x] Fix supported break/division and layout cases with semantic mutation and real-render regressions.
- [x] Inspect printed pages, record correction provenance, and correct only unambiguous transcriptions.
- [x] Verify proposed mappings and preserve explicit editor choices.
- [x] Freeze changes, generate current approvals, verify baseline preservation, and prepare reviewed PRs.
- [x] After merged changes, publish current approved records and verified manifests. Done in #127 (728 live).
