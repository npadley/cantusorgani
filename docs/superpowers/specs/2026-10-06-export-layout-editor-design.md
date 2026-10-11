# Export layout editor and LilyPond-to-MEI conversion

Date: October 6, 2026

Status: Revised 2026-10-08 after CEO, design and engineering review. The settled decisions are in the [decision log](../plans/export-layout-decisions.md) (D1–D11). The screen, states and copy are in the [UI specification](2026-10-08-export-editor-ui-spec.md); types and units are in the [frozen contracts](../plans/2026-10-08-export-contracts.md); work is in the [execution packet](../plans/2026-10-08-export-execution-packet.md). Where this document conflicts with those, they win. The Kyrie IX feasibility experiment informed this specification; the complete editor mockups (gate G0) and production engraving (gate G1) are not yet approved.

## 1. Outcome

Let organists prepare readable accompaniment PDFs for their paper, printer, music desk, **or tablet reader app such as forScore**. Users choose parts, page size (print, iPad screen, or custom), orientation, margins, staff size, systems per page, spacing, and system/page breaks; the music reflows, and they download a PDF whose pages are exactly the chosen physical size and match the paper preview (decisions D1, D2).

Build a reusable conversion pipeline so most supported LilyPond scores can enter this editor automatically. Conversion must preserve the music and expose unsupported engraving instead of silently simplifying it. LilyPond remains the authoritative source; MEI is a generated, reviewed derivative used for browser layout.

The first public release is a reviewed pilot starting with **Missa IX, Kyrie IX**, not an automatic migration of the whole catalogue. Catalogue coverage expands as conversions pass both automated and visual checks. No account or third-party rendering service is required.

## 2. Current behavior and feasibility evidence

The Astro site currently selects export parts in `web/src/components/ExportBar.astro`. `web/src/lib/pdf.ts` packs scanned system images into Letter/A4 pages and inserts pre-rendered LilyPond PDF pages for typeset runs. The export follows the reader's scan/typeset selection and uses `web/src/workers/pdf.worker.ts` for assembly. `web/src/lib/typeset.ts` identifies matched typeset segments, source-system ranges, render hashes, and existing proofreading state.

`pipeline/typeset/render.py` generates fixed narrow/wide SVGs and Letter/A4 PDFs using the pinned LilyPond version. `pipeline/typeset/events.py` and `listen.ily` already extract chant events for matching/auditing, but their existing matching representation is insufficient for full polyphonic conversion. Reuse the trusted runner, source checks, and suitable event-extraction infrastructure without changing their matching semantics.

The experiment independently generated MusicXML 4.0 with `senza-misura` and MEI 5.0 from LilyPond's resolved music tree, then rendered both with Verovio 6.3.0. It preserved four voices, 358 pitched events, five invisible skips, and 60 printed lyric syllables; all pitched onsets and pitches matched the resolved source. It was specific to one file and was not fully schema validated. Its omitted entry markers, approximate Gregorian divisions, and different spacing are **unresolved production requirements**, not accepted losses.

It also established that:

- Browser layout responds to paper dimensions, staff size, line breaks, and a systems-per-page maximum.
- Full-page SVGs need visible page boundaries. With Letter, large staff, and automatic reflow, MEI placed four systems on page 1 and one on page 2; unused paper was mistaken for inter-system spacing in the experiment. **The experiment ran Verovio at `scale: 40`, so its staves were about 0.4× physical size; its system counts are not acceptance criteria (D8).**
- Verovio's `breaks="line"` preserves source line breaks while paginating; exact `breaks="encoded"` can override the systems-per-page cap.
- The MusicXML import placed lyrics below the staff despite requested above-staff placement. Direct MEI supported above-staff placement.
- This experiment used modern noteheads matching the accompaniment. It did not demonstrate square-neume chant plus accompaniment in one score.

## 3. Scope and decisions

### Included

1. A catalogue feature audit and reproducible converter with structured diagnostics.
2. Reviewed MEI assets and a separate conversion-approval record tied to their input and tool versions.
3. An export layout editor accessible from the existing export area.
4. Layout controls for all score sources where their representation supports them.
5. Browser rendering of approved MEI, a clearly paginated preview, and matching PDF export.
6. Source/scan comparison during conversion review and a staged catalogue rollout.

### Excluded from the first release

- Editing notes, pitches, lyrics, or accompaniment; transposition and playback.
- Arbitrary LilyPond uploads, source execution in the browser, or a public compiler service.
- Replacing the existing reading-page renderer or its separate GABC/Exsurge chant display.
- Combining square-neume chant and organ notation into a new shared encoding.
- Public MusicXML export, round-trip MEI editing back into LilyPond, or treating MEI as the new master.
- Dragging individual noteheads, arbitrary per-note spacing, or promising an exact number of systems on every page.
- Cloud accounts, shared layout presets, or integration with Bachable/Hacklily.
- **Music-font (Bravura) and text-font (serif/sans) choices.** v1 ships Leipzig and one bundled text face; the controls are not rendered (D3).

MEI is the proposed first production target because it provides direct access to Verovio's representation and placement controls. MusicXML remains an experiment/reference, not a second production pipeline. If MEI cannot meet the pilot fidelity requirements, retain current exports and reconsider the renderer before broad conversion.

## 4. User flow and interface

Keep the current quick **Export PDF** action available. Add **Customize export** alongside it. Opening customization carries over the selected parts, their catalogue order, and the current scan/typeset choices. Never silently substitute MEI for a scan the reader deliberately selected.

The editor is a full-screen native `<dialog>` with a history entry, so Back closes it (D7). On desktop, show a 20rem settings column and the paper preview; below 62rem, settings stack above the preview with groups collapsed except FIT. The header identifies the selection; the footer provides **Download PDF · N pages**, **Reset layout**, and **Undo** after a reversible change. Close returns to the reading page without changing its display preferences. The complete screen, state and copy specification is the [UI specification](2026-10-08-export-editor-ui-spec.md).

Settings are grouped as **FIT** (music size, systems per page, live result line), **PAGE**, **BREAKS**, and a closed **More options** (sung text size, space between systems). Availability is specific to each selected part. Mixed exports identify which parts support music controls with plain labels such as “Customizable typeset” and “Original scan.” Technical format names do not belong in the ordinary export flow.

### Controls

| Control | Proposed first-release behavior |
| --- | --- |
| Page size | **Print:** Letter (215.9 × 279.4 mm), A4 (210 × 297 mm), A5 (148 × 210 mm). **iPad:** mini, 11-inch, 13-inch at the physical screen size, so the PDF fills the screen in forScore (dimensions in contracts `PAGE_PRESETS`, verified by spike S7). **Custom:** width × height, 90–450 mm each side, long side ≤ 3× short side, entered in mm or inches (D4). |
| Orientation | Separate Portrait/Landscape control for **every** page size. Swap dimensions; do not rotate the music as an image. |
| Margins | One margin value, 3–25 mm; default 12 mm for print sizes, 4 mm for iPad and Custom. Print sizes below 6 mm show a non-blocking printer advisory. Applied to every page, with headings inside the usable area. |
| Staff size ("Music size") | Small 5.6 mm, Medium 7.2 mm, Large 9.6 mm; Medium default. These are physical staff heights (Verovio `unit` 7/9/12 at `scale: 100`), not preview zoom. |
| Music font | Leipzig only in v1; no control (D3). |
| Text font | One bundled face in v1, chosen by spike S3 to match Verovio's lyric metrics; no control (D3). The same font assets and metrics are used for lyrics/headings in preview and PDF. |
| Lyrics size | Small, Medium (default), Large, initially Verovio `lyricSize` 3.5, 4.5, and 5.5 MEI units. Relative to staff size; values are versioned and subject to pilot visual approval. |
| Systems per page | "As many as fit" or a **maximum** of 1–8, set with a −/+ stepper whose first − press goes to one fewer than currently fit. Fewer may fit because of staff size, margins, headings, and explicit breaks. |
| System spacing | Compact, Normal (default), Spacious, initially Verovio `spacingSystem` 2, 4, and 8 MEI units. These are minimum-spacing settings, subject to collision avoidance and pilot approval. |
| Line breaks | Original line breaks (default for typeset parts) or Automatic reflow. Both paginate for the chosen paper and system cap. |
| Part starts | Each selected part starts on a new page in the first release. This preserves current typeset behavior and avoids ambiguous scan/typeset joins. |

Do not offer font/staff/reflow controls as if they could change scanned notation or a fixed LilyPond PDF. Scan parts support paper, orientation, margins, and system packing. A selected system maximum counts complete scanned system images or complete typeset systems, never individual staves.

Fixed LilyPond-only parts are labeled “Fixed typeset layout.” Their original PDF page is proportionally fitted, without cropping or distortion, into the chosen page's usable rectangle. The label states that typography and original line breaks remain fixed. This distinguishes a fitted original page from genuine re-engraving.

### Break editing

For approved MEI parts, selecting a musical boundary offers **Start new system here**, **Start new page here**, and **Remove my break**. Show boundaries in an editing overlay; omit them from the PDF. Use “phrase” or “break point,” not invented metrical measure numbers, for free-meter chant.

Only offer boundaries the converter has marked safe: all voices can cross without lost notes, ties, lyrics, or voice-line glissandi. Each boundary carries `afterText` (the last sung word before it) so labels read “after ‘eléison’”. Break points are shown only in an explicit break-editing mode (UI §4). Preserve explicit user anchors when page/orientation/staff size changes. Defaults and user overrides are separate: **Reset layout** removes the user's breaks and restores every setting to its default **except page size and orientation**; source breaks remain; Undo is offered instead of a confirmation.

Priority is: user page breaks, user system breaks, selected original/automatic line-break policy, then automatic page packing under the system cap. A page-break anchor also begins a new system. Automatic pagination may add breaks. It must not remove user breaks or exceed the cap. Reject unsatisfiable layout constraints with a specific explanation rather than silently changing staff size or discarding anchors.

## 5. Preview and export contract

**Paper preview** is the primary view. Show the selected physical aspect ratio, page boundary, margin area, and “Page N of M · preset” outside the printable page. The page stays white (`--print-paper`) in dark mode. Display actual page/system counts after rendering. Blank paper at a page bottom remains visible and clearly belongs to that page; when more than 25% of a page's usable height is unused and another page of the same part follows, show “The rest of page N is blank: the next system doesn't fit.” outside the page. Preview zoom changes display magnification only.

Offer **Continuous view** as a secondary reading aid. It can crop unused page bottoms while preserving a consistent display scale and content order. It does not change the paper layout or export and is visibly labeled as a reading view.

The preview reflows on every change with no Apply button; stepper presses and custom-size entries coalesce for 250 ms. Show “Updating preview…” (after 300 ms) while retaining the previous preview. Every job has a revision token; obsolete results cannot replace the latest preview. Download is disabled until all selected parts have a current, complete layout. Errors identify the affected part and retain the user's settings. Visible error text comes only from the UI copy deck keyed by diagnostic code, reason and suggestions; worker messages are never shown.

One canonical layout result supplies both the paper preview and PDF. It includes page dimensions, page SVGs, headings/rubrics/credits, ordered part IDs, effective break anchors, font profile, source hashes, renderer version, and a settings digest. PDF generation must use this result rather than rerunning a separate pagination algorithm.

PDF pages have the selected physical dimensions. Typeset notation stays vector; required fonts are embedded or converted to paths. Scans retain their original resolution. Include existing attribution, rubrics, translations, and selected part headings. Download success reports the actual page count and file size.

Use a dedicated SVG-to-vector-PDF adapter and the existing PDF assembly layer for scan/fixed-page composition. Spike S4 chooses between PDFKit + SVG-to-PDFKit and a pdf-lib + fontkit walker over Verovio's SVG subset; neither is verified for these assets yet. Leipzig glyphs are SVG paths, so only text fonts are embedded. Font mapping, SVG `<use>` references, accented lyrics, and page geometry must pass the PDF fidelity gate before adoption. Do not silently rasterize typeset notation or use browser print as a substitute for a reliable Download PDF action.

## 6. Conversion architecture

Conversion happens at build/review time, not per visitor. The browser loads pre-converted data and re-engraves it locally. Extend the existing pinned runner and content-hash publishing model.

### 6.1 Catalogue audit

Inventory all LilyPond sources (859 at review time; none are empty, so “absent” means a catalogue target with no source), their dependency closures, matched catalogue targets, number of scores/staves/voices, include families, and notation/engraving constructs. Group shared patterns and emit exceptions with source locations. Report unsupported features and compilation failures explicitly. The audit must distinguish absent transcriptions from failed conversions and must not claim a coverage percentage before it is run. The review found 857/859 sources carry a hidden `voiceLines` voice, 92 use `\voiceLine` cross-staff glissandi and 45 use `\quil`; Kyrie IX uses none of these, so the pilot fixture set is F1–F5 (D6, contracts `PILOT_FIXTURES`).

### 6.2 Extraction and intermediate representation

Use the pinned LilyPond compiler to resolve variables, relative pitches, durations, includes, and Scheme expressions. The proposed mechanism is a new iteration-time listener (`pipeline/typeset/mei/listen_full.ily`) that reads `associatedVoiceContext` for exact lyric anchors and acknowledgers for notehead/stem/division properties; spike S1 confirms it and fixes the TSV grammar (contracts §4). The experiment's parse-tree dump (python-ly `xml-export.ily`, GPL) is not vendored (D9). Do not depend on the experimental converter's line-number voice selection or its lyric-to-slur heuristic.

Capture every staff and simultaneous voice, score boundaries, exact rational onsets/durations, notated duration and scaling, pitched attacks, invisible skips/rests, keys/accidentals/clefs, ties/slurs, lyric syllables and their actual note associations, entry markers, divisions, source breaks, and supported cross-staff events. Keep resolved sounding pitch distinct from printed accidental behavior and notehead appearance.

Provide stable event/boundary IDs within an input revision, source filename/location anchors, and feature-level provenance. Layout overrides refer to those IDs and the revision; they cannot be reapplied blindly to changed music. Do not collapse repeated attacks into ties or simplify simultaneous voices for convenience.

### 6.3 MEI generation

Emit a pinned MEI schema with conventional notation for these accompaniment sources, no invented regular meter, and explicit staff/layer identities. Preserve above-staff lyrics, notehead values, hidden stems, ties, and slur groups. Rational durations must remain exact even when represented using hidden scaling constructs.

Synchronization/layout containers are an implementation detail, with invisible boundaries except where the source contains a division. They do not imply chant performance beats. Where a legal break requires subdividing a sustained event, preserve its combined duration and sustain with ties, retain the original event identity in provenance, and validate the normalized musical result. If this cannot be done faithfully, that boundary is unavailable.

Map supported house-style functions to musical meaning and renderer behavior rather than dropping Scheme definitions wholesale. In particular, `finalis`, `divisioMinima`, other divisions, `quil`, cross-staff voice-leading lines, entry markers, and lyric/slur spacing each need an explicit supported rule or an unsupported diagnostic. Commands discovered by the audit extend this inventory.

Every unsupported musical feature blocks approval. Engraving differences produce specific review diagnostics and can be accepted only through an explicit visual-review record. No generic “best effort” success state. Do not manually edit generated MEI as a permanent fix; fixes belong in source corrections or versioned conversion rules.

### 6.4 Validation and review

Validate XML against the pinned MEI schema. Compare generated/rendered events with the extracted source using exact rational timing, staff/voice identity, pitch, attacks versus sustained continuations, complete lyrics and anchors, ties/slurs, divisions, and total durations. MIDI pitch/onset checks alone are insufficient.

Generate per-score evidence: original LilyPond rendering, converted rendering, corresponding scan context where available, feature diagnostics, and localized semantic differences. Automated geometric checks detect clipping/overflow and suspicious collisions; they assist visual review rather than establish engraving approval.

Every score receives a visual check before public customization. Review common patterns using a stratified pilot, then give unusual or flagged files closer inspection. Conversion approval is distinct from the site's existing transcription/proofreading acknowledgment. A conversion may accurately preserve a transcription that still contains a source error.

States are `unsupported`, `failed`, `needs-review`, and `approved`. Records include source/dependency hash, extractor/converter/profile/schema/renderer versions, artifact hash, diagnostic codes, reviewer decision, and the reviewed validation matrix. Any relevant input or version change invalidates approval until revalidated and reviewed.

### 6.5 Artifact publication

Publish immutable MEI and provenance/validation assets under a conversion digest. Maintain a separate manifest mapping existing catalogue targets and source render hashes to approved conversion digests and capability flags. Use the current reviewed segment boundaries and matching rules; a converted file does not automatically establish a catalogue match.

Publish only approved assets to the public editor. Retain LilyPond SVG/PDF outputs and scan assets. Extraction uses the repository's source checks and trusted include policy; the existing isolated build execution rules also apply. No visitor-supplied source is compiled.

## 7. Browser layout and application integration

Pin and bundle Verovio WebAssembly and supported font resources in the application build. The experiment used 6.3.0; production adoption requires the same fidelity checks for the exact selected build. Lazy-load the editor/renderer on customization; ordinary reading and quick export must not acquire its startup cost. Self-host resources using existing asset conventions rather than runtime dependence on a third-party CDN.

The worker receives approved part assets, versioned settings, and per-part boundary overrides. It generates a layout result and diagnostics. Treat source/system-break policy, manual anchors, and page cap as separate constraints; do not blindly pass exact encoded mode and assume the cap will be honored. Materialize the final effective breaks and check all constraints before presenting a downloadable result.

Use a style adapter for approved chant conventions, keeping renderer-specific options out of UI state. Typography changes must update font metrics and re-engraving rather than CSS-scaling an existing SVG. Sanitize generated SVG before insertion and namespace IDs per score/page to avoid cross-page glyph/reference collisions.

Extend the export selection model without equating source scan indices with reflowed output-system counts. Catalogue segment/source ranges determine which parts are selected; renderer output determines new page/system counts. Preserve existing export ceilings and selection checks; add bounded resource limits for MEI jobs based on pilot measurements.

If a conversion is unavailable, show its existing scan or fixed typeset route. If an approved asset/renderer fails during customization, block the custom download and offer an explicit **Use original layout** recovery action. This returns to the existing quick-export controls and explains that custom music settings will not apply. Do not quietly export different notation or settings from the completed preview.

Save page/orientation preferences and versioned layout defaults locally (key `export-layout-v2`), with graceful operation when storage is blocked. Default paper remains Letter, orientation Portrait. Migrate the current `export-paper` preference. Per-part manual overrides include the source revision; discard stale anchors with a visible explanation after a source change. Browser settings do not write to catalogue/source files.

## 8. Acceptance criteria and release gates

### Conversion gate

- An audit reports the actual catalogue feature inventory and unsupported cases.
- Voice/staff discovery and lyric anchoring work across different source structures without Kyrie-specific line numbers.
- Kyrie IX preserves every voice, pitch, rational timing, lyric anchor, entry marker, division, tie, and slur; no unsupported item is concealed.
- The stratified pilot covers each supported feature family, including long held accompaniment, internal phrase breaks, accented lyrics, division variants, and cross-staff notation when present.
- Deliberately removed voices, changed pitches, timing changes, missing endings/lyrics, broken ties, and unsupported commands fail validation with localized diagnostics.
- Schema validation and conversion approval are tied to the current artifact and tool versions.

The representative pilot runs the 13-case matrix in contracts §3 (print sizes in both orientations, both line policies, small/large staff, the two-systems cap, iPad mini/11-inch, and a custom 160 × 230 mm page) on every pilot fixture F1–F5. Each additional score receives semantic checks plus visual inspection at its default layout and Letter/Large/Automatic stress layout. A newly discovered feature family expands the representative matrix before that family is enabled publicly.

### Layout gate

- All print, iPad and custom page sizes work in both orientations; PDF pages are exactly the chosen size (± 0.01 pt) and the measured staff height is within ± 0.1 mm.
- Original and automatic line policies preserve music. Manual breaks survive layout changes; impossible constraints explain the conflict.
- The systems-per-page maximum is honored, with fewer systems allowed when content cannot fit.
- Paper preview marks every page boundary; continuous view leaves the exported pagination unchanged.
- Every page is visibly separate and the final system is always present. No exact system count is asserted (the experiment's 4 + 1 result was measured at `scale: 40`; D8).
- An 11-inch-preset PDF imported into forScore on a real iPad fills the screen (B10b).
- No default supported layout clips content or loses final systems. Font/size changes preserve accents and symbols.
- Stale jobs cannot replace newer previews; busy/error states and keyboard/touch operation work on desktop and narrow screens.

### PDF and integration gate

- Preview and PDF have identical page dimensions, ordering, headings, system breaks, page breaks, and supported typography.
- Typeset paths/fonts remain sharp and complete; compare rendered PDF pages against the canonical SVG pages.
- Mixed approved-MEI/scan/fixed-type selections retain all selected content and attribution, with correctly limited controls.
- Quick export, source reading, existing scan/type switches, selection ceilings, and source matching remain operational.
- A slow renderer, failed asset, blocked storage, or interrupted export produces a recoverable state without losing settings or silently changing the output.

Record cold renderer startup, first preview, subsequent setting-change latency, PDF generation time, peak worker memory, and asset sizes on the pilot's desktop and tablet browsers. Establish production resource limits from those measurements in the implementation plan; single-score feasibility does not establish catalogue-scale performance.

## 9. Delivery boundaries and review handoff

Implement in three separately reviewable stages: conversion audit/pilot, editor and vector-PDF pilot, then incremental catalogue enablement. Each stage must meet its applicable gates before the next expands scope. No full-catalogue effort estimate is reliable before the audit.

Before implementation, review this specification and approve the complete editor mockups. The next deliverable is an implementation plan that orders the extraction, fidelity, and PDF proofs before production UI integration. The experimental comparison is reference evidence, not the final editor mockup or production code.

## References

- Existing integration: `web/src/components/ExportBar.astro`, `web/src/lib/pdf.ts`, `web/src/lib/typeset.ts`, `web/src/workers/pdf.worker.ts`, `pipeline/typeset/render.py`, `pipeline/typeset/events.py`, `pipeline/typeset/listen.ily`, `docs/TYPESETTING.md`.
- Primary renderer documentation: [Verovio options](https://book.verovio.org/toolkit-reference/toolkit-options.html), [SVG geometry and physical staff size](https://book.verovio.org/advanced-topics/controlling-the-svg-output.html).
- Encoding: [MEI conventional notation](https://music-encoding.org/guidelines/v5/content/cmn.html), [MEI neumes](https://music-encoding.org/guidelines/v5/content/neumes.html), [MusicXML senza-misura](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/senza-misura/).
- Proposed PDF adapter evidence: [SVG-to-PDFKit](https://github.com/alafr/SVG-to-PDFKit), [PDFKit browser support](https://pdfkit.org/docs/getting_started.html).
- Experimental artifacts are checked in by task S0: `docs/superpowers/experiments/kyrie-ix/` (README with provenance, reference-only `convert.py`), `tests/fixtures/mei/kyrie-ix/` (validation baseline, derived `baseline-events.json`, experiment MEI), and `web/src/lib/export-layout/__fixtures__/`. The originals were produced in Codex session `01a10f81-7606-7733-b9d5-b66fceed337e`. Production must not rely on a developer's temporary environment or chat storage.
