# Plan: Proper parts, a usable export, and chant links

**Required Skill**: executing-plans
**Design doc**: `docs/claudekit/specs/2026-09-07-nova-organi-harmonia-design.md`

## Goal

**Problem** (reported 2026-09-26, looking at 3 October, St Thérèse):

1. A Proper page is one undivided stack of systems. There is no way to jump to
   the Gradual or the Communion, and no way to leave out what is not sung today
   (the Tract outside Lent, the Paschal Alleluia outside Eastertide).
2. The PDF export refuses anything over 60 systems. St Thérèse is 90 (her Mass
   prints both a Tract and a Paschal Alleluia), so the day cannot be exported at
   all. The refusal says "use the individual movement pages instead" — those
   pages exist only for Kyriale Masses. It is a dead end.
3. There is no route from a Proper to its chant. An organist accompanying a
   schola wants the chant the choir is singing next to the accompaniment.

**Goal**: every Proper divided into its parts (Introit, Gradual, Alleluia, Tract,
Sequence, Offertory, Communion), each with a working jump link and a link to its
chant; an export that builds any day's music **in the order of Mass** (Proper parts
interleaved with the Ordinary's movements) and lets the organist choose the
parts; no message that points at something that does not exist.

Done means: on the live site, 3 October shows St Thérèse's parts, each jump link
lands on its part, "Export" defaults to the parts sung on that date and
produces a PDF, and each part links to its GregoBase chant.

## Verified facts (measured 2026-09-26, not assumed)

| Fact | Value | Consequence |
|---|---|---|
| Export slice size | `@2x.png` slices are **10–13 KB** each (5 sampled from St Thérèse) | 90 systems ≈ 1.1 MB. The 60-system cap guards against a memory problem that does not exist. The real cost of a long export is paper (~4.5 systems per A4 page). |
| Where the cap lives | `MAX_EXPORT_SYSTEMS = 60` (`web/src/lib/config.ts`) and `MAX_SYSTEMS = 60` (`web/src/lib/pdf.ts`, enforced in `buildPdf`) | Both must change together; the Worker throws on the second. |
| Proper parts today | None. Movements exist only for Kyriale Masses (`MOVEMENT_DIVISIONS = {kyriale, defunctorum}`; invariant `test_only_masses_have_movements`) | New data, not a fix of old data. |
| Printed part labels, as OCR reads them under the staves (NOH3, 96 Propers with music) | "Intr." found in 63, "Grad." 40, "Offert." 37, "Comm." 31, "Tract." 20; Alleluias carry no label at all | **Labels alone cannot segment a Proper.** A second, independent signal is required. |
| Mode numbers | Printed left of the first system of every chant; already read into `SystemRef.mode_marker` | A candidate boundary signal, free. |
| jgabc (`bbloomf.github.io/jgabc/propers.html`) | **Unlicense** (public domain). `propersdata.js` holds `proprium`: **632** entries (days of both Propers, 23 Commons, votives), each with GregoBase chant IDs per part: `inID` 518, `grID` 516, `alID` 362, `trID` 122, `seqID` 19, `ofID` 518, `coID` 518, plus `alPaschID`, `trSeptID`, `alExtraID` variants | An authoritative, per-day list of **which parts exist and which chant each is** — the second signal, and the chant links, in one vendorable file. |
| jgabc keys | `Oct3`, `Sep26a`, `Pent18`, `Quad3w`, `EmbSatSept`, `ChristusRex`, `mass_holy_pope`, `nuptialis`… | Need a tested mapping from our 1962 keys (`sancti:10-03`, `tempora:Pent18-0`, `commune:…`). |
| jgabc deep links | Selecting a feast sets `propers.html#saint=Oct3` | A per-day link to the full Proper in chant is one string. |
| GregoBase | Chant page per ID (`gregobase.selapa.net/chant.php?id=59`). Dump already vendored locally (`vendor/gregobase_online.sql`, sha256-pinned, gitignored). Licence: site says CC BY-SA 4.0; repo has no LICENSE — **open question recorded in `data/LICENSES.md`** | Use GregoBase texts **only inside the pipeline** (to find parts); **publish links, not chant data.** Sidesteps the open licence question entirely. |
| Demand signal | Reported by the site's owner and maintainer (an organist) on 2026-09-26, looking at 3 October. The site has no analytics, so export refusals and page views cannot be counted; `data/catalog.json` gives the size of the problem: count of Propers over 60 systems, to be recorded in the step-0 commit | Step 0 ships regardless; chant links (step 7) ship in release 2 unless the owner defers them |
| Existing pairing | `chant` field: incipit-matched GregoBase pairings on 38 pieces | Superseded by the jgabc mapping; kept only as a cross-check where both exist. |

## Architecture

```
jgabc propersdata.js ──► data/jgabc-propers.json (vendored, Unlicense, pinned sha256)
        │                       │
        │  day → {part: GregoBase id}          our 1962 key → jgabc key
        ▼                       ▼                     (pipeline/jgabc.py, tested table)
GregoBase dump (local) ──► part incipits (text only, never published)
        │
        ▼
catalog build: for each Proper, expected parts in order + incipits
        │   + per-system text, label hits, mode markers
        ▼
pipeline/parts.py  segment_proper()  — ordered segmentation, like segment_mass()
        │
        ▼
catalog.json  piece.parts = [PrintedPart | BorrowedPart]
        PrintedPart  = {part, variant, system:int, ref, gregobase_id:int|null,
                        placed:'label'|'text'|'order', score:float}
        BorrowedPart = {part, variant, borrowed_from:slug, borrowed_ref, gregobase_id}
        ExpectedPart = {part, variant, incipits:tuple[str,...], gregobase_id, borrowed_from?}
        borrowed refs resolved after merge_catalog in link_parts(catalog), like link_rubrics
        │
        ▼
site: part headings + jump links (shared jumpTargets), per-part chant links,
      jgabc day link, export with part selection (season-aware defaults)
```

## Work

### 0. Ship-first wedge (release 1, before step 1)

The export refusal is a constant and a sentence; the day's chant is one link.
Neither waits for segmentation.

- One shared ceiling: `EXPORT_CEILING = 300` in `web/src/lib/config.ts`,
  imported by `pdf.ts` and the Worker (replacing `MAX_EXPORT_SYSTEMS` and
  `MAX_SYSTEMS`). The value is confirmed by building 150- and 300-system PDFs in
  Safari on an iPad and recording peak memory in the commit (pdf-lib decodes
  PNGs while embedding, so 1.1 MB compressed is not the peak).
- The refusal never mentions movement pages (copy in step 6).
- A per-day "Chant (jgabc)" link to the whole Proper (step 7's day link),
  which needs only step 1's key mapping.
- Deploy on the owner's go-ahead. 3 October then exports (90 systems).

Steps 1–8 are release 2.

### 1. Vendor the jgabc mapping — `pipeline/jgabc.py`, `data/jgabc-propers.json`

- A verb (`uv run noh jgabc-fetch [--commit SHA]`) downloads `propersdata.js` at a pinned
  commit, extracts `proprium` to JSON **without executing JavaScript** (the file
  is a JS object literal; parse it with a strict literal parser, reject anything
  else — security rule: no dynamic code execution), and records the source URL,
  commit and sha256 in the JSON's header. Licence noted in `data/LICENSES.md`.
- `jgabc_key(day_key) -> str | None`: `sancti:MM-DD[suffix]` → `MonD[a-z]`;
  `tempora:Pent18-0` → `Pent18`; weekday and Ember keys; Commons by the NOH4
  Commune title (`Commune Confessoris Pontificis` → `mass_i_confessor_bishop`);
  votives by title. An explicit table where names differ; **every unmapped key
  is reported, never guessed**.
- Tests: table-driven mapping (`test_jgabc_key_[kind]_[scenario]_[expected]`);
  every catalogued Proper day either maps or is on an explained list; the
  vendored file's sha256 matches its header.

- Error copy, exactly:
  - unmapped key: `unmapped: sancti:10-03 'S. Theresiae a Jesu Infante' -- add it
    to JGABC_TABLE in pipeline/jgabc.py, or to EXPLAINED_UNMAPPED with a reason.`
  - sha mismatch: `data/jgabc-propers.json sha256 <x> does not match its header
    <y> -- re-run uv run noh jgabc-fetch; do not hand-edit.`
  - parser meets unexpected syntax (upstream format change): `jgabc-fetch`
    exits non-zero naming the line, and leaves the vendored JSON untouched.
- Tests: `test_parse_proprium_valid_literal_returns_dict`,
  `test_parse_proprium_function_call_rejected_raises`,
  `test_parse_proprium_unexpected_token_leaves_file_untouched`.

### 2. Expected parts per piece

- `expected_parts(piece) -> list[ExpectedPart]`: from the piece's own day (first
  own day; Commons by title), the parts jgabc lists **in liturgical order**:
  introit, gradual, (tract | alleluia), sequence, offertory, communion — with the
  printed variants a NOH page carries: `alPasch` (Paschal Alleluia) and `trSept`
  (Tract after Septuagesima) as **separate optional parts**.
- Parts printed by reference in NOH ("Introitus. Mihi autem, ut supra, p. 4",
  already recorded in the index's `reference`) are **borrowed**: expected, but
  located in the referenced piece, not segmented here.
- Incipit text per part from the local GregoBase dump (first ~6 words,
  normalised like `movements.OPENINGS`).
- Temporale pieces with several Masses or processions (Christmas, Candlemas,
  Ash Wednesday, Palm Sunday, Ember Saturdays with 4–5 Graduals) use jgabc's
  entry where it lists them; otherwise they get **no parts** and a
  `part_unsupported` review entry. No guessing.

- If the GregoBase dump or `data/jgabc-propers.json` is absent or fails its
  sha256, the catalog build **does not segment**: it keeps each piece's
  previous `parts` (carried through `merge_catalog`), never writes order-only
  placements, and exits non-zero with `parts need vendor/gregobase_online.sql
  (not in git); see README "Vendored data"`. It must not quietly write pieces
  with no parts, as `load_chants() if DUMP.exists() else []` does today.

### 3. Segment — `pipeline/parts.py`

`segment_proper(systems: list[SystemFeature], expected: list[ExpectedPart]) -> list[PartBoundary]`,
mirroring `segment_mass`, which already works on the Kyriale:

- Parts are placed **in order**; each begins at or after the previous part's
  minimum length (`MIN_SYSTEMS`: introit 3, gradual 3, alleluia 2, tract 3,
  sequence 3, offertory 2, communion 2 — to be calibrated on NOH3).
- A system scores for a part by: incipit match of its text (fuzzy, as
  `movement_score_for`), plus a bonus for the printed label (`Intr.`, `Grad.`,
  `Tract.`, `Offert.`, `Comm.`; OCR variants from the measured sample:
  `lntr.`, `(ntr..`, `In.tr.`, `Inte.`, `Comrn.`), plus a bonus for a mode
  marker. A label followed by "ut supra / ibid. / Pars" is a **reference line,
  not a start** (measured: "Graduale. Qui operatus est, ut supra, p. 45.").
- Fallback when no system is confident: placed by order within a window,
  `placed: "order"`, review entry `part_by_order`. A part that cannot be placed
  at all: `part_missing`, never dropped silently.
- Output: `PrintedPart` / `BorrowedPart` exactly as in the Architecture diagram.
  Borrowed parts are resolved in `link_parts(catalog)` after `merge_catalog`,
  because the lending piece may sit in another volume (NOH4's Commons).

Calibration: run over NOH3 first, then NOH1–2, NOH4; report per volume the share
of pieces fully placed by text/label vs by order; **hand-check a random sample
of 30 part starts against the rendered page images** and record the result in
the commit message.

Tests (synthetic `SystemFeature` lists, no dump needed):
`test_segment_proper_label_present_places_by_label`,
`test_segment_proper_reference_line_ut_supra_not_a_start`,
`test_segment_proper_no_confident_system_places_by_order_and_queues`,
`test_segment_proper_too_few_systems_marks_missing`,
`test_segment_proper_first_incipit_absent_marks_mismatch`,
`test_segment_proper_duplicate_graduals_ember_saturday_keeps_both`,
`test_segment_proper_empty_input_returns_empty`; and for `link_parts`:
`test_link_parts_borrowed_across_volumes_resolves_anchor`,
`test_link_parts_lender_missing_queues_review`.

Calibration is re-runnable: `uv run noh catalog --volume noh3 --parts-report`
prints placed by label/text/order/missing, and writes
`build/parts-sample-noh3.html` with 30 random part starts beside their slice
images for the hand check. The catalog summary line gains `N parts placed
(label L, text T, order O), M missing`.

### 4. Catalogue

- `piece.parts` (new field; `movements` stays Ordinary-only, so
  `test_only_masses_have_movements` keeps its meaning).
- Invariants (`tests/test_catalog_invariants.py`):
  - parts run in reading order, each within the piece's systems;
  - no part twice unless jgabc lists it twice (Ember Saturday Graduals);
  - every part placed by order, missing, or unsupported is in the review queue;
  - borrowed parts point at a piece that exists;
  - St Thérèse (golden): introit at system 0, gradual at 8, then tract,
    alleluia (paschal), offertory, communion at hand-verified systems.

- Every `part_*` review entry carries piece slug, pdf page, part, expected
  incipit, best-scoring system and its score, so triage can act without
  opening the code.

### 5. Site: part headings and jump links

- Extend `jumpTargets()` (`web/src/lib/catalog.ts`) to Propers: one target per
  part, labelled (Introit, Gradual, Alleluia, Paschal Alleluia, Tract,
  Sequence, Offertory, Communion). `SystemStack` renders a heading with the
  anchor at each part's first system — the same mechanism that fixed the
  Kyriale links, so a link cannot point at nothing.
- Borrowed parts appear in the nav in italics as "Introit → St Michael, p. 4"
  and link to the anchor on the lending piece. `ChantPair` is removed from
  Propers that have parts, so a page never shows two chant links.
- Day pages: under the Proper heading, each part is a link to
  `/piece/<slug>/#<anchor>` (the day page shows no music). On piece pages the
  order stays as today: jump nav, then export, then music. The export's part
  list stays collapsed so it never pushes the music below the fold.
- Tests (Vitest + Astro container, as `MovementNav.test.ts`): every Proper with
  parts renders a nav whose every `href="#…"` has a matching `id`; borrowed
  links resolve to real pages and anchors.

- On Propers the nav's `aria-label` is "Parts of the Proper".

### 6. Export: part selection instead of a cap

- Replace the 60-system refusal with **part selection**: the export bar lists
  the parts (checkboxes), and the button builds only the checked ones.
- **Season-aware defaults** on day pages, from the date the page is showing:
  the Tract only from Septuagesima to Holy Saturday, the Paschal Alleluia only
  in Eastertide, the ordinary Alleluia otherwise; all other parts checked, except the Gradual in Eastertide (the Paschal
  Alleluia replaces it). A part that is the piece's only Alleluia or Tract is
  always ticked. Defaults use the build-time `findNextDate` date, so the
  weekly rebuild keeps them current.
  Piece pages default to everything.
- Keep a **safety ceiling** sized from the measurement (e.g. 300 systems ≈
  3.6 MB), shared by `config.ts` and `pdf.ts` from one constant; its message reads: "This selection is N systems (about P pages); the limit
  is 300. Untick <largest ticked parts, named, with sizes> to fit." It never
  says "use the movement pages".
- The PDF gets a part heading (text) above each part's first system, so the
  printout is navigable at the bench.
- Tests: `validateSelection` bounds; selection → refs mapping; season defaults
  (`should exclude the Tract after Easter`, etc.) against `liturgy.ts` dates;
  ceiling boundary (300 builds, 301 is refused) and page count for a
  150-system build.

- States: (a) nothing ticked: button disabled, reads "Tick at least one part";
  (b) pieces without parts show no checkboxes and export whole, as today;
  (c) the button label updates live: "Export PDF (41 systems, ~10 pages)";
  (d) over the ceiling: button disabled, message names the largest ticked
  parts ("Untick the Tract (14 systems) to export"); (e) on day pages a visible
  line says "Defaults for Saturday 3 October 2026 (Tract and Paschal Alleluia
  unticked)"; (f) Worker errors keep the existing `data-state="error"` status.
- Accessibility: the parts sit in a `<details>` ("Choose parts (5 of 7)"),
  collapsed by default so the sticky bar under 62rem stays one row; inside, a
  `<fieldset>` with `<legend>Parts to export</legend>` of real
  `<input type="checkbox">`s whose `<label>`s are at least `--tap-min` tall
  and wholly tappable; the live count goes to the existing `role="status"`;
  tab order summary → checkboxes → button.

### 7. Chant links

- Each part heading carries a separate secondary link, "Chant", after the
  heading text (`--font-ui`, `--step--1`, `--ink-muted`, at least `--tap-min`).
  The heading itself is never a link, so a stray tap mid-service cannot leave
  the music. It opens in a new tab and links to its GregoBase chant page
  (`https://gregobase.selapa.net/chant.php?id=<id>`), `rel="noopener"`, with
  attribution per `data/LICENSES.md`.
- Each Proper (piece and day page) links to the whole Proper in jgabc
  (`propers.html#saint=Oct3`, `#sunday=Pent18`, `#common=mass_holy_pope` —
  confirm each hash form against the live page before shipping).
- Links only: **no GregoBase GABC, images or texts are published** until the
  licence question is answered.
- Tests: link URLs built from ids (encoding, no unvalidated input), one per
  part, absent when no id.

- Links read "Chant" with "(GregoBase, opens in new tab)" in `.sr-only`.

### 8. Verify and ship

- Python: full suite, coverage ≥ 80% overall and ≥ 95% on `parts.py` and
  `jgabc.py` (critical path: wrong starts are the product failure).
- Web: Vitest, `astro check` 0 errors, production build.
- Browser (local preview): 3 October — parts nav, each link lands, export
  defaults (Tract/Paschal Alleluia unticked in October), PDF builds with 5
  parts; a Lent feria (Tract ticked); Easter week (Paschal Alleluia); a
  borrowed-part day (Guardian Angels' Introit from St Michael).
- Deploy only on the user's go-ahead; re-verify live.

- First run, in order: `uv run noh doctor` (fails if
  `vendor/gregobase_online.sql` or `data/jgabc-propers.json` is missing or its
  sha256 does not match, and prints the fix); `uv run noh jgabc-fetch` (only
  when refreshing); `uv run noh catalog --volume noh3 --parts-report`; read the
  parts summary line.
- Docs: the README gains "Vendored data" (jgabc and GregoBase: where they come
  from, how to refresh, how to pin); `doctor` gains `check_jgabc()` and
  `check_gregobase_dump()`, each with a `Fix:` line in the existing style.
- Rollback: `parts` is additive. Keep `SCHEMA_VERSION = 2`; the site reads
  `p.parts ?? []`, so old and new catalogs work with either site build. Commit
  in separately revertible phases: (0) wedge, (1) jgabc vendor, (2) pipeline +
  catalog.json, (3) site nav/links, (4) export part selection. Regenerate all
  volumes in one run so catalog.json never mixes old and new records.

## Risks

| Risk | Mitigation |
|---|---|
| OCR of chant text under the staves is syllable-split and noisy | Same fuzzy normalisation that places Kyriale movements; label and mode-marker bonuses; order fallback flagged for review |
| 1942 NOH Propers differ from 1962 jgabc Propers for some days | Where the first expected incipit never matches anywhere in the piece, mark `part_mismatch` for review instead of forcing order placement |
| jgabc key naming is irregular (`Quad3w`, `Sep26a`) | Explicit tested table; unmapped keys reported, not guessed |
| Multi-Mass and processional days | Supported only where jgabc lists their parts; otherwise `part_unsupported`, visible in the review queue |
| GregoBase licence unresolved | Links only; texts used internally for matching and never published |
| GregoBase dump absent at build | Parts generation aborts and keeps previous `parts`; never writes order-only placements (step 2) |
| pdf-lib decodes PNGs while embedding, so peak memory exceeds the compressed 1.1 MB | Ceiling set from a measured iPad Safari build of 150 and 300 systems (step 0) |
| jgabc parser meets unexpected syntax | `jgabc-fetch` exits non-zero and leaves the vendored JSON untouched (step 1) |
| Vendored data drifts from upstream | Pinned commit and sha256; refresh is a deliberate script run |

## Out of scope

- Embedding chant notation (GABC/Exsurge) on our pages — revisit after the
  GregoBase licence question is answered.
- Vesperale (NOH8) antiphons and psalms as parts.
- NOH3 addenda and the other outstanding catalogue items.

**Next moves this plan must not block:** (v2) whole-Mass export in liturgical
order from `piece.parts` + `movements` + the day's Ordinary; (v3) embedded GABC
beside each part once the GregoBase licence is settled, keyed by the
`gregobase_id` stored per part; Vesperale antiphons reusing `segment_proper()`
with a different expected-parts source.

## Open questions for the user

1. Season-aware export defaults: default by the page's date as proposed, or
   always everything checked?
2. Should the day page's export include the Ordinary by default (it does today)?
