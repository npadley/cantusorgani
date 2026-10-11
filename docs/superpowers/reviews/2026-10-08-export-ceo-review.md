# CEO Review: Export layout editor + LilyPond-to-MEI packet

Date: 2026-10-08. Reviewed: spec `2026-10-06-export-layout-editor-design.md`, coordination plan, Plans A/B/C, and the originating Codex transcript. Context checked: `web/src/lib/pdf.ts`, `ExportBar.astro`, `pipeline/typeset/render.py` (`FORMATS`, lines 58–61), `data/typeset/manifest.json` (772 matched typeset targets), `data/typeset/src/**` (859 `.ly` files), `Layout.astro` (GoatCounter loaded, no export events).

**Overall**: 3.2/10

The engineering is careful. The strategy came from following the conversation, not from deciding. The demand is **one organist** asking for "page size, font, staff size, number of systems." Codex first answered: "keep LilyPond and add on-demand rendering behind our own export controls … my preferred approach" (transcript, line 102). It also said: "A change of file format is not required to give users those layout controls" (line 161). The maintainer then asked "is there a better file format?" (line 128). That question was really about whether MusicXML could express unmetered chant, which is a concern for the conversion route only. The Kyrie experiment answered it, and the spec followed straight from the experiment. Nobody ever compared it back against the LilyPond routes. The result is a second engraving pipeline, a browser constraint solver, a vector-PDF adapter and five approval gates, all to deliver **one Kyrie**. LilyPond already engraves 772 parts, and `render.py` already emits PDFs from a format table.

## Scores

| Dimension | Score | What would make it 10 |
|---|---|---|
| Ambition | 5/10 | Target "every typeset part bench-ready on any desk" rather than "one Kyrie fully re-engravable"; the mechanism is ambitious, the reach is not. |
| Problem clarity | 4/10 | Name the requesting organist's actual failure (can't read at console distance? desk too narrow? page turns?) instead of restating their four-word control list. |
| Wedge focus | 3/10 | One user job (large-print bench copy) with 3–4 controls for all typeset parts, not 11 controls × 3 part kinds × break editing for one score. |
| Demand reality | 2/10 | One request is a real signal, but nobody followed up on it. Go back to that organist with a prototype, and instrument exports before sizing v2. |
| Future-fit | 4/10 | Sketch v1→v3 with LilyPond presets first; show the per-score review cost scales to 772 parts before committing to MEI. |

## Findings ranked by severity

### S1. The LilyPond routes were never re-evaluated against MEI (Ambition, Wedge)
- Evidence: "MEI is the proposed first production target because it provides direct access to Verovio's representation and placement controls." (spec, line 52). The spec's only alternative is MusicXML. The spec excludes "a public compiler service" (line 45) and "integration with Bachable/Hacklily" (line 50) without saying why.
- Codex's own comparison (transcript, lines 104–108) listed three routes: a native LilyPond service, conversion, and **pre-rendered layout presets** ("Simple hosting; predictable output"). The packet dropped two of them silently.
- **Assessment of the three routes, given a static Cloudflare/R2 site and a pinned, isolated LilyPond 2.26 runner:**
  - **Pre-rendered presets (recommended v1).** Zero new runtime infrastructure and exact LilyPond fidelity, and it reuses the existing render → R2 → manifest path. Rendering whole pages for paper × orientation × staff (18 variants × 772 parts ≈ 14k PDFs) would not cover systems-per-page. A better shape is to render **one cropped vector PDF per system** per (line width × staff size) and let `pdf.ts` pack those systems exactly as it packs scans today. Then margins, headings, paper, orientation and the systems-per-page cap all happen client-side through the existing `embedPdf`/`drawPage` code. There are about 3 line widths (portrait Letter/A4, landscape, A5) × 3 staff sizes, so about 9 renders per part and about 7k files. CI already renders "only what R2 lacks". The open risk is whether LilyPond 2.26 crop/one-system-per-page output behaves well with the house includes, which a 2-day spike settles.
  - **Server rendering (fallback / v2 if presets prove too coarse).** It allows arbitrary values with real LilyPond. But it means a new always-on service off Cloudflare Workers, which cannot run the native binary, plus rate limiting, a DoS surface and 2–10 s renders. Inputs would be whitelisted settings only, never source. Bachable is an option only if they offer an API: their terms (§§4, 9–11, cited at transcript line 78) promise no availability and restrict commercial use without permission. Send the email, but keep it off the critical path.
  - **MEI/Verovio (v3, conditional).** This is the only route that gives instant interactive reflow, per-phrase break editing, and later transposition. Those are the features that justify Plan A's cost, and none of them was requested.

### S2. The demand is one request, and nobody has followed up (Demand)
- Evidence: the transcript (line 5) has the single request: "changin the page size, font, staff size, numbber of systems." The spec never cites it, and nobody has asked what "font" meant (text size? lyric font? notation font?) or what device, desk and paper the organist uses.
- GoatCounter is loaded (`Layout.astro:126`), but no export event fires, so export volume and the Letter/A4 split are unknown.
- Consequence: the control list has been treated as a specification when it is really a symptom. Music font (Leipzig/Bravura), lyric size and system spacing go beyond even this one request.

### S3. The mockups requested in the first message were never produced (Problem clarity, Wedge)
- Evidence: "create mockups for approval and then write a spec and plan" (transcript, line 5). Codex deferred them: "I'll hold the mockups and spec until we settle this rendering question" (line 42). Spec line 197 still requires mockup approval before implementation, and B1 is where mockups first appear, as a parallel task inside a 20-task programme.
- A one-day mockup shown to the requesting organist is the cheapest demand test available. It should come first and include a preset-only variant.

### S4. No kill criteria with numbers or a time box (Future-fit)
- Evidence: "If MEI cannot meet the pilot fidelity requirements, retain current exports and reconsider the renderer before broad conversion." (spec, line 52). "Retaining current exports is the fallback if the fidelity gate cannot pass." (coordination, line 159).
- The fallback is "do nothing". With the presets slice shipped first, the fallback becomes "keep shipping presets", and each kill point becomes cheap to honor.

### S5. Catalogue scaling cost is unbounded (Future-fit)
- Evidence: "Every score receives a visual check before public customization." (spec, line 136). "Reviewers must never approve a score merely because a sibling using the same includes passed." (rollout, line 134).
- That means 772 parts × (default + stress layout) × a signed decision each, which is hundreds of maintainer-hours. The packet measures this only after the pilot ships (C4). Measure it in A1/A3 instead. The presets route needs none of this review, because the LilyPond output *is* the proofread engraving.

### S6. Gate ceremony is sized for a team, not a solo maintainer
- Evidence: G0–G4 with distinct "Decision owner" roles (coordination, lines 149–155); "independent reviewer" on every task; "at least five runs per condition on a desktop and a real tablet browser" (rollout, line 90).
- **Keep:** A4 mutation-based validation (if MEI proceeds); revision-bound invalidation; B5 SVG sanitization; one canonical result driving both preview and PDF; stale-token rejection; reuse of the existing secret-free compile/upload split (`test_typeset_workflows.py`).
- **Cut:** collapse five gates to three; review per plan rather than per task, except A2/A4/B4; three iPad runs instead of five per condition; a single batch decision file instead of per-score signed JSON.

### S7. Research tasks are disguised as bounded tasks for cheap models
- Evidence: "Implement a reviewed resolved listener/compiler-tree adapter." (A2, line 92). "inspect rendered system starts, add safe effective page breaks, rerender, and verify convergence" (B4, line 124). "If this adapter fails, evaluate one concrete vector alternative" (B2, line 78).
- These are open design problems. Sonnet or Haiku will stall or quietly weaken checks. The allocation table (coordination, lines 66–72) never says which tasks Haiku must not touch. None of the 20 tasks has an estimate.

### S8. The experiment evidence sits outside the repo, and the spec says so
- Evidence: "Experimental artifacts are retained in this chat's `kyrie-ix-experiment` directory" (spec, line 205).
- Verified present at `(the original Codex experiment directory, outside the repo)`: `convert.py`, `kyrie-ix.mei`, `kyrie-ix.musicxml`, `lilypond-resolved.xml`, `validation.json`, `README.md`, `comparison.html`, `build_comparison.py`, the SVGs, and `../kyrie-ix-comparison.html`. It is one `rm` away from loss, and A2's baseline counts (358/5/60) depend on it.

### S9. Strategic omissions
- No export analytics and no feedback link.
- No share link (URL-encoded settings).
- No page-turn awareness. A turn in mid-phrase is the real bench pain, and "systems per page" is only a proxy for it.
- No v2/v3 trajectory.

## Strengths worth preserving
- LilyPond stays the master, and nothing is silently substituted (spec, lines 11 and 56).
- The honest "Fixed typeset layout" labeling with proportional fitting (spec, line 80).
- The canonical `LayoutResult` driving both preview and PDF (spec, line 98).
- A4's mutation oracle, which is what would make any converter trustworthy.
- Quick export stays untouched, and heavy assets are lazy-loaded (B9).
- The page-boundary finding from the experiment (spec, line 26), which applies to every route.

## Recommended fixes (copy-pasteable)

1. **ceo-fix-1: Make LilyPond presets v1.** In `2026-10-06-export-layout-implementation-plan.md`, section "1. How to execute this packet", add before the plan table:
   > **Slice 0: LilyPond bench presets (v1, ships first).** S0.0 (Opus, ≤2 days): spike rendering Kyrie IX plus two long Propers as one cropped vector PDF per system with pinned LilyPond 2.26 (`render.py` FORMATS; line widths: portrait 190 mm, landscape 255 mm, A5 128 mm; staff 16/18/22). Pass: every system is present, crops are tight, house includes work, and `pdf-lib` `embedPdf` stays vector. S0.1 (Sonnet): add those formats to `render.py`/manifest, rendering only what R2 lacks. S0.2 (Sonnet): extend `web/src/lib/pdf.ts` `BuildOptions` with `orientation`, `marginMm` (8–25), `paper: "a5"`, `staff`, and `maxSystemsPerPage`, and pack typeset systems the way scans are packed. S0.3 (Sonnet): add the controls to `ExportBar.astro` with a paper-preview thumbnail. S0.4 (Haiku): analytics (ceo-fix-2). Plans A/B start only after K0.
2. **ceo-fix-2: Instrument demand.** In Plan B, add task **B0 Export analytics** before B1:
   > Files: `ExportBar.astro`, `web/src/lib/analytics.ts` + test. On a successful download call `window.goatcounter?.count({path: 'export/' + paper + '/' + orientation + '/' + staff + '/' + maxSystems, title: 'export', event: true})`, with no part names. Add a "Was this the layout you needed? Tell us" `mailto:` link under the export status. Test: it is a no-op when `goatcounter` is undefined.
3. **ceo-fix-3: Talk to the requester.** In the spec, section "1. Outcome", add:
   > **Demand evidence.** One organist requested page size, font, staff size and systems-per-page changes (2026-10-05). Before Plan A: ask them which font they meant, what device/paper/desk they use, and what currently goes wrong at the bench; then show them the B1 mockup and the Slice 0 build. Record the answers in `export-layout-decisions.md`.
4. **ceo-fix-4: Do the mockups first.** In Plan B, B1, replace "**Dependencies:** Spec only; parallel with conversion." with:
   > **Dependencies:** None; **first task in the packet** (requested 2026-10-05, never produced). Produce two variants: (a) Slice 0 presets inside the existing export bar; (b) the full editor. Show both to the requesting organist before S0.1.
5. **ceo-fix-5: Add kill criteria.** In the coordination plan, section "5. Gates…", add:
   > **Kill/decision points.** K0 (8 weeks after Slice 0 ships): start Plan A only if ≥15% of exports use non-default settings AND users ask for something presets cannot do (arbitrary reflow, per-phrase breaks, transposition). Otherwise Slice 0 is the product. K0b: if users ask for arbitrary values rather than reflow, evaluate server rendering (Bachable API reply or a small LilyPond container) before MEI. K1 (A2+A3 time box, 4 weeks): if Kyrie IX cannot reach zero semantic differences with entry markers and divisions rendered, stop Plan A. K2 (A1): if the pilot feature families cover <60% of the 772 matched parts, re-scope to a named sub-catalogue (for example the Kyriale). K3 (B2 time box, 2 weeks): if no vector adapter passes the accents and `<use>` glyph checks, stop Plan B. Every stop leaves Slice 0 in place.
6. **ceo-fix-6: Cut the controls.** In the spec, section "Controls", replace the Music font and System spacing rows with:
   > | Deferred | Music font (Bravura) and system spacing: no request names them. Lyric/text size stays pending the requester's answer about "font". |
7. **ceo-fix-7: Defer break editing.** In the spec, section "Break editing", add at the top:
   > Deferred to the MEI release after K0. v1 offers Original/Automatic line policy and the systems-per-page cap only.
8. **ceo-fix-8: Check in the experiment.** In Plan A, A1, add the first step:
   > - [ ] Copy `convert.py`, `kyrie-ix.mei`, `kyrie-ix.musicxml`, `lilypond-resolved.xml`, `validation.json`, `README.md`, `comparison.html`, `build_comparison.py`, the SVGs, and `kyrie-ix-comparison.html` from `~/.codex/visualizations/2026/10/06/01a10f81-…/kyrie-ix-experiment/` into `tests/fixtures/mei/kyrie-ix-experiment/`. Strip absolute paths and add provenance (date, Verovio 6.3.0, LilyPond 2.26) to the README. Commit `chore: preserve Kyrie IX MEI experiment as reference fixtures`.

   In the spec, replace "Experimental artifacts are retained in this chat's `kyrie-ix-experiment` directory" with "Experimental artifacts are checked in at `tests/fixtures/mei/kyrie-ix-experiment/`".
9. **ceo-fix-9: Record the route decision.** In the spec, section "3. Scope and decisions", replace "MEI is the proposed first production target because…" with:
   > Route order: (1) pre-rendered LilyPond per-system presets, which give exact engraving and no new infrastructure; (2) on-demand LilyPond rendering (Bachable API if offered, else a small isolated service) if users need arbitrary values; (3) MEI/Verovio only for interactive reflow, phrase breaks or transposition, gated by K0. The Bachable email (draft in the 2026-10-06 session) is sent but is not on the critical path.
10. **ceo-fix-10: Measure the review cost early.** In Plan A, A1 "Handoff", add:
    > Time a full visual review of Kyrie IX plus 2 structurally different sources in wall-clock minutes. Project hours = minutes × (matched parts in supported families) / 60. Record the result for K2.
11. **ceo-fix-11: Collapse the gates.** In the coordination plan, replace the G0–G4 table with three gates: G-Interface (B1, maintainer + requester), G-Fidelity (A4/A5/B2, maintainer on an Opus recommendation), and G-Release (B10, C1 via the existing workflow pattern, rehearsed rollback, 3 iPad runs, maintainer).
12. **ceo-fix-12: Tier tasks by model.** In the coordination plan, section 2, add:
    > **Model tiers.** Opus/human only: S0.0, A2, A3, B2, B4, and the review of A4. Sonnet: S0.1–S0.3, A1, A4–A6, B3, B5–B9, C1, C3. Haiku: B0/S0.4, test scaffolding inside accepted interfaces, fixture/README updates, and C4 runs under existing rules. Haiku never edits a validator, oracle or sanitizer allowlist. A2 and B4 each begin with an Opus-written design note (a property → mechanism → fixture table; cap-enforcement pseudocode with a termination argument) before any implementer starts.
13. **ceo-fix-13: Share links and the trajectory.** In the spec, section "9. Delivery boundaries", add:
    > **Trajectory.** v1 = Slice 0 presets for all typeset parts and scans, with share links (`?paper=a4&orient=landscape&staff=large&max=3`). v2 = page-turn-aware packing (prefer page ends at phrase-final systems) and, if K0b triggers, server rendering. v3 = MEI reflow, phrase breaks and transposition for families that pass K1/K2.
14. **ceo-fix-14: Add estimates.** In the coordination plan's table, add an estimate column (Slice 0: 2–3 wk; A: 4–6 wk; B: 5–7 wk; C: 2 wk + per batch). State that no A/B task except B0/B1 starts before K0.
