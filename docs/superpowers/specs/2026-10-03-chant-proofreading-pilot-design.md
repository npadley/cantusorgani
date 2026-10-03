# Melody-first proofreading pilot

Approved in chat on October 3, 2026: the user selected the proposed deterministic-first plan and requested isolated worktrees. Base: fix/broken-typeset-2 at dd8acc16da7742454c88880b60f497b693d29864. Native implementation keeps coding overhead low; small, fresh-context agents inspect ambiguous evidence only.

## Outcome

Create a reproducible local melody audit and a stratified 30-file pilot. It compares LilyPond chant-voice events to the catalogue-selected GregoBase GABC and produces localized review evidence. No automatic source fixes, catalogue matches, full-proofreading acknowledgments, publication, or changes to the active checkout.

## Contract

- Select remaining matched files by current render hash, excluding current reviewed acknowledgments. Include missing-GABC items in the pilot and report them explicitly.
- Preserve attacks, ties, accidentals, lyric/time anchors, and source origins. Accidental glyphs and custos are not sung notes. GABC compressed bivirga/tristropha shapes represent repeated attacks.
- Require full sequence agreement under a single diatonic transposition for a diatonic-clean result. A subsequence or rounded match score never passes. Chromatic and repeat uncertainties remain visible and require review.
- Explicit ij/iij phrase expansion may generate a second candidate; doxology reconstruction remains a documented comparison candidate, not proof of the printed version. No silent truncation of psalm verses or tails.
- Compare chromatic intervals separately. Accidentals whose scope is not verified and undocumented variants cannot produce an unqualified melody pass.
- Empty data, failed compilation, unsafe source, malformed/unsupported GABC, simultaneous chant voices and invalid ties become blocked/review results, not clean results.
- Results include file, target, source commit, source hash, render hash, GABC hash, event context hash, algorithm version, transformations, note counts and localized discrepancies. Changing any input invalidates reuse.
- A local HTML/JSON report contains source excerpts, lyric anchors and full matched scan-system context where available. Show available local wide renders; missing renders are explicit. Render image inputs are drawings, never injected SVG markup.
- Review workers receive compact packets, inspect only assigned cases, and return findings with evidence and uncertainty. They cannot mark full proofreading complete. Authoritative scan comparison determines whether GABC differences are errors or NOH variants.

## Validation

Test exact transposition, insertion/deletion, changed note, missing ending, repeat attacks vs ties, accidental glyph vs actual pitch, compressed strophas, malformed input, source locations and versioned remaining inventory. Run a 30-file pilot and summarize status/counts. Test deliberate mutations; sample clean cases independently. AI classification alone does not establish full proofreading.
