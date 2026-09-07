# Design: Nova Organi Harmonia Online
Date: 2026-09-07

## Summary

A searchable public website for the *Nova Organi Harmonia* (Lemmens Institute /
Mechelen, 1942; public domain), covering the Temporale, Sanctorale, Commune,
Kyriale, Varia and Vesperale. Readers find any Sunday, feast day, Mass Ordinary
or Vespers office and export a single assembled PDF containing exactly the
propers and settings they selected. Ships as cleaned scan imagery with a rich
liturgical catalog; true re-engraving is a later, incremental quality upgrade
tracked per piece rather than a launch blocker.

## Source material (verified 2026-09-07)

| File | PDF pages | Notes |
|---|---|---|
| NOH1 Advent-Easter.pdf | 380 | Temporale part I |
| NOH1 missing pages.pdf | 6 | DCTDecode patch, greyscale |
| NOH2 Easter-Advent.pdf | 293 | Temporale part II |
| NOH3 Proprium Sanctorum.pdf | 499 | |
| NOH4 Commune Sanctorum.pdf | 418 | |
| NOH5 Kyriale.pdf | 231 | Pilot volume |
| NOH7 Varia.pdf | 274 | |
| NOH8 Vesperale.pdf | 344 | Office, not Mass |

- ~2,445 pages, 230 MB total. Bitonal JBIG2, ~300 dpi (≈2540×3490 px), clean
  scans with low skew.
- **Every page carries an embedded OCR text layer** (verified 2026-09-07 via
  PDFKit; a byte-level font scan misses it because the fonts sit in compressed
  object streams). It is noisy 1990s-grade OCR — `EXSEQUDS` for `EXSEQUIIS`,
  `Festls` for `Festis`, `II` for `11` — so it is a *signal*, never ground truth.
  It yields running heads, folio numbers, Latin text, Mass titles and composer
  initials for free, and makes full-text Latin search available at launch.
- **NOH6 is absent from the source set.** Decide whether to source it.
- Front matter is French (Malines, 18 May 1942, Card. van Roey to Canon Van
  Nuffel, Lemmens Institute). Provenance and PD status confirmed.

### Notation reality (drives every downstream decision)

NOH does **not** print neumes. Each system is a braced two-staff organ score:
the chant melody appears as *stemless black noteheads* on the upper staff over
half/whole-note accompaniment, with Latin text set **above** the system, chant
divisions in place of barlines, no time signature, and transposed key
signatures.

Consequence: off-the-shelf OMR (Audiveris et al.) keys off stems, measures and
meter, and degrades badly on this repertoire. **OMR is deliberately off the
critical path.**

### Reference edition (not a publication source)

Two 1.16 GB files — `Nova Organi Harmonia - Full PDF.pdf` and a `- OCR` variant —
are the **Corpus Christi Watershed** edition, 2201 pages each (the ~244-page gap
against our 2,445 is the repeated per-volume front matter, deduplicated).

They are **reconciliation input only** and must never reach the site:

- `CCWATERSHED.ORG/CAMPION` branding is burned into every page image.
- Pages are re-numbered with CCW's own sequence and appear re-cropped; the
  original folio and running head are absent from sampled pages, which would
  destroy the folio cross-check.
- Their front matter includes a modern Van Nuffel preface translation credited to
  D. Cook — under copyright, unlike the 1942 content.
- ~516 KB/page versus ~94 KB, and the music renders softer (grayscale
  antialiasing) than the crisp bitonal originals.

Their value is as an independent second opinion on page ordering and
completeness. `data/volumes.yml` is an explicit **allowlist**, never a glob over
`pdf-source/`, so these files cannot be picked up by accident.

### The index discovery

Every volume ends with a printed `INDEX PARTIS` — a clean, typeset two-column
table of liturgical day → printed page number (~70 entries/page). The catalog
skeleton is obtainable by OCR'ing ~a dozen index pages, not by reading 2,445.

Printed page 353 sits at PDF page 378 in NOH1: a per-volume front-matter offset
exists and must be **verified, never assumed**.

## Decisions

| Decision | Choice |
|---|---|
| Fidelity | Hybrid — ship images now, re-engrave incrementally |
| Calendar | 1942 as-published substrate + 1962 projection over it |
| Catalog source | Bootstrap from chant DBs, cross-validated against NOH indices |
| Export cuts | System-level cropping |
| Architecture | Static site + narrow serverless edge (Approach 3) |
| Corrections | Cloudflare D1 queue + public status page |
| Chant pairing | Piece-level: GregoBase GABC rendered beside NOH accompaniment |
| Licensing | CC-BY-SA accepted for catalog + chant renderings; scans remain PD |

Deferred (YAGNI): Novus Ordo calendar mapping, user accounts, saved Mass sets,
server-side PDF generation, phrase-level and note-level chant alignment, NOH6
(Belgian diocesan propers only — additive later, no schema impact).

## Architecture

Four artifacts, one strict derivation order, nothing authored twice.

```
pdf-source/          8 PDFs, read-only, never modified
     |
pipeline/            Python, offline, idempotent, re-runnable from scratch
     |  render -> clean -> segment -> index-ocr -> reconcile -> publish
     v
data/                canonical, git-tracked, ONLY hand-editable output
     |-- volumes.yml            per-volume page offsets, verified
     |-- catalog.json           pieces: incipit, genre, mode, day, system refs
     |-- calendar-1942.json     substrate: what the books contain
     |-- calendar-1962.json     projection: 1962 day -> 1942 entries
     |
     +--> web/        Astro static build -> Cloudflare Pages
     +--> R2          system images (WebP) + original page images
                            ^
workers/corrections  ------+  public POST API -> D1 -> triage CLI -> git
```

**Governing rule:** everything under `pipeline/` must be reproducible by
deleting its outputs and re-running. No human ever hand-fixes a derived image or
generated index — otherwise the pipeline stops being trustworthy and cannot
safely be re-run, which it will need to be as system detection improves.

**Calendar layering.** `calendar-1942.json` records what each volume actually
prints. `calendar-1962.json` is a mapping table with an explicit per-mapping
`status`: `identical` | `renamed` | `reformed` | `suppressed` | `no-equivalent`.
Holy Week (rewritten 1955) and the suppressed octaves/vigils are the hard cases;
keeping that difficulty as explicit *data* rather than implicit code is what
makes it maintainable and lets the site show honest provenance instead of
silently serving the wrong Introit.

**Intake is dynamic; the canon stays static.** D1 is a mailbox, never a source of
truth. The published site must always be rebuildable from `pdf-source/` plus
`data/` alone.

## Components

### pipeline/ (Python)

Six independent stages, each writing to `build/` with a manifest so stages
re-run in isolation.

1. **render** — PDF → 300 dpi PNG (PyMuPDF). Establishes *and verifies*
   per-volume printed↔PDF offset by OCR'ing printed folios on sampled pages.
2. **clean** — deskew, despeckle, border removal. Bitonal in, bitonal out.
3. **segment** — horizontal projection profiles locate staves; brace detection
   groups staves into systems. Load-bearing CV step; prototype first on NOH5.
4. **index-ocr** — Tesseract (Latin) over `INDEX PARTIS` pages → day → printed page.
5. **reconcile** — join index-OCR × embedded text layer × GregoBase/Cantus Index
   × offset table × CCW page census. Agreement between the two independent OCR
   readings (embedded layer and Tesseract) counts as verification; disagreement
   is routed to review rather than published.
   Emits high-confidence entries plus `review-queue.json` for disagreements.
6. **publish** — WebP encode, upload to R2, emit `catalog.json`.

### web/ (Astro, static)

Routes: `/day/[slug]`, `/piece/[id]`, `/kyriale/[mass]`, `/vespers/[slug]`.
Pagefind indexes incipits and Latin texts at build time. Client-side Mass
builder keeps selections in URL state (shareable links); PDF assembly runs in a
Web Worker via `pdf-lib`. A typical Sunday is ~8 pages ≈ 700 KB of imagery,
comfortably within client-side reach.

#### Reading experience (primary mode)

**Music is viewable in the browser without downloading anything.** PDF export is
for the organ bench; the site itself is meant to be read. Each page lays out the
piece's WebP system slices vertically in reading order, full-width, lazy-loaded
below the fold — the same assets the PDF exporter consumes, so there is no
second rendering path to maintain.

Two properties follow directly from system-level slicing:

- **Deep links land on music, not on a page.** `/piece/introit-ad-te-levavi`
  shows that Introit alone, not the scan page it shares with the Gradual.
- **Reflow.** Systems are independent images: narrow screens stack, wide screens
  can column. Fixed-page PDFs cannot do this.

Known limitation: 300 dpi bitonal scans show scanner artifacts past ~150% zoom.
Serve 2× WebP for the detail view and let the browser downscale. This resolves
for free on any piece later re-engraved.

#### Chant pairing

Each catalogued piece links to its GregoBase GABC. GABC is notation *source*,
not an image, so the square-note chant is rendered fresh alongside the 1942
accompaniment — giving the organist the melody as printed in the chant books
next to the harmonisation written for it.

Rendering approach to be confirmed during the pilot (verify current maintenance
status of each before committing):

- **Build-time Gregorio → SVG** — gold-standard output, adds a LaTeX toolchain
  to the pipeline, renders once and ships as a static asset. Preferred.
- **Client-side Exsurge** — pure JS, no build dependency, lighter output quality
  and less actively maintained.

Licensing consequence: GregoBase is CC-BY-SA, so this moves attribution from an
ingest concern to a **display** concern. Every page showing a rendered chant
carries attribution, and share-alike attaches to the chant renderings and
derived catalog data. The NOH scans are public domain and unaffected — the data
model must keep PD scan assets and CC-BY-SA chant data clearly separated so the
distinction survives into the licence notice.

### workers/corrections (TypeScript, Cloudflare)

Single `POST /corrections` endpoint. Per project security rules: strict schema
validation at the boundary, no `any` types, parameterized D1 queries only,
Turnstile + per-IP rate limiting, all stored text treated as untrusted.

**Public status page renders structural fields only** — `piece_id`, `field`,
`proposed_value` (validated against a per-field enum or pattern), and status.
Submitter free-text notes stay private until triaged. Spam has nowhere to
render, while submitters still see their report was received and acted on.

### tools/triage (CLI)

Pulls pending D1 rows, displays the cited page image beside the proposed change,
writes accepted edits into `data/` as a git commit, marks the row `accepted`
with the commit SHA.

## Data Flow

**Build time** (local machine, hours of CPU — not CI):

`pdf-source/*.pdf` → render → `build/pages/{vol}/{pdf_page}.png` → clean →
segment → `build/systems/{vol}/{page}/{n}.json` (bounding boxes) → slice →
`build/systems/**.webp`.

In parallel: `INDEX PARTIS` pages → index-ocr → `build/index/{vol}.json`.
Then reconcile joins OCR'd index + chant DB piece lists + offset table into
`data/catalog.json` and `review-queue.json`. Publish pushes WebP to R2.

**Read time:** Astro build reads `data/*.json`, emits static HTML for every day,
piece, Kyriale Mass and Vespers office. Readers get pre-rendered HTML; system
images stream from R2. Selection updates URL state; export fetches only selected
system images and assembles in a Web Worker.

**Correction flow:** reader clicks a field → `POST /corrections`
`{piece_id, field, proposed_value, note}` → Worker validates schema + Turnstile
+ rate limit → D1 insert `status='pending'` → status page renders structural
fields → triage CLI → git commit → rebuild → submitter sees it go green.

## Error Handling

Ranked by damage. The dangerous failures are the quiet ones.

| Failure | Impact | Mitigation |
|---|---|---|
| Wrong page offset | Poisons every reference in a volume, looks plausible | OCR printed folio on 20 sampled pages/volume; assert constant offset; fail build loudly. Never a hand-entered constant. |
| Index OCR digit error (353→358) | Serves wrong music confidently | Cross-check every OCR'd page number against the folio printed on that PDF page. Disagreement → review queue, never publication. |
| System segmentation merge/drop | Silently truncates an export | Per-page assertions: system count in expected range, no overlapping boxes, no box below minimum height. Detected boxes renderable as overlay for spot-checks. |
| Reconciliation gap | Day with no DB match, or vice versa | Expected, not an error. First-class `unmatched` state, shown as "catalogued, not yet verified" rather than hidden. |
| Missing R2 asset | Broken render | Build-time invariant check; at read time a placeholder naming the missing system id. |
| Browser PDF OOM | Export fails on large selection | Cap selection size, assemble incrementally, fall back to page-range PDF. |
| Correction abuse / XSS | Published spam on your domain | Turnstile, rate limiting, boundary schema validation, structural-only public rendering, no untriaged free text on the site. |

## Testing Strategy

Backbone: a fixture set of ~30 hand-verified pages spanning all eight volumes,
chosen for the nasty cases — a day boundary mid-page, a Holy Week page, a
psalm-tone table, the "missing pages" patch, a front-matter page with no music.

1. **Offset invariants** — per volume, assert constant printed↔PDF offset across
   sampled pages. Fast; catches the worst bug.
2. **Segmentation regression** — hand-labelled system boxes on fixture pages;
   assert IoU above threshold and exact system count against a stored baseline,
   so a detection "improvement" that regresses three volumes is caught.
3. **Catalog invariants** (pure data, CI, seconds) — every day resolves to ≥1
   piece; no two days claim overlapping page ranges within a volume; every
   system reference resolves to an existing R2 key; every 1962 mapping resolves
   to a 1942 entry or carries explicit `no-equivalent`; no piece lacks genre or
   mode.
4. **Worker boundary tests** — malformed payloads rejected, oversized fields
   rejected, rate limit enforced, XSS payload round-tripped through submit →
   status page and proven inert.
5. **End-to-end** — build the PDF for Dominica I Adventus; assert page count and
   that first and last systems match fixtures.

## Sequencing

**Start with NOH5 (Kyriale).** Smallest volume (231 pp.), self-contained, zero
calendar mapping, constantly needed by every parish, and it exercises the entire
pipeline end to end. If the Kyriale ships well, the Temporale is the same
machine pointed at harder data.

Then: NOH1+NOH2 (Temporale, the core "every Sunday" promise) → NOH8 (Vesperale)
→ NOH3/NOH4 (Sanctorale/Commune) → NOH7 (Varia).

## Open Questions

1. ~~**NOH6**~~ — **Resolved 2026-09-07:** contains Belgian diocesan propers only.
   Out of scope for launch; additive later with no schema impact. Document the
   gap on the site.
2. ~~**Chant database licensing**~~ — **Resolved 2026-09-07:** CC-BY-SA accepted.
   `data/catalog.json` and chant renderings carry CC-BY-SA with GregoBase
   attribution; NOH scan assets remain public domain and are labelled separately.
   Cantus Index terms still need checking if it is used beyond GregoBase.
3. **Chant renderer** — Gregorio (build-time, LaTeX dependency) vs Exsurge
   (client-side JS). Verify current maintenance status of both during the NOH5
   pilot before committing.
4. **GABC match confidence** — piece-level pairing is only as good as the
   reconciliation. Decide the confidence threshold below which a pairing is
   shown as "unverified" rather than presented as authoritative.
5. **Re-engraving target format** for the incremental quality upgrade —
   LilyPond (superb output, chant idioms need custom work) vs MEI (better
   semantics and interchange, weaker rendering). Not needed at launch.
6. **"Missing pages" patch** — determine which NOH1 pages these six replace and
   how they splice into the page-offset model. They are DCTDecode/greyscale at
   different dimensions from the main scan, so `clean` needs a separate path.
7. **Vespers data model** — Office structure (antiphons, psalms, hymn,
   Magnificat) differs enough from Mass propers to warrant its own schema shape
   rather than being forced into the propers model.
8. **1962 mapping authority** — which published source settles disputed
   mappings, so the `status` field is defensible rather than editorial?
