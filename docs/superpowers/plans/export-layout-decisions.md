# Export Layout — Decision Log

Append-only. Each entry: date, ID, decision, evidence, owner. Spikes (S0–S7) append their outcomes here before any dependent task starts. Agents must not reopen a recorded decision; raise a blocker to the coordinator instead.

| ID | Date | Decision | Evidence / reason | Owner |
|---|---|---|---|---|
| D1 | 2026-10-08 | **MEI/Verovio in-browser reflow is v1.** Pre-rendered LilyPond presets and server-side LilyPond are not v1. Server-side native LilyPond (reusing `render.py::wrap`) is the named fallback **only** if gate G1 (musical fidelity) or G2 (PDF fidelity) fails. | Organist request: change page size, staff size and number of systems and have the music reflow. Kyrie IX experiment matched all 358 pitches and onsets in MEI. CEO review's presets-first recommendation was considered and rejected. | User |
| D2 | 2026-10-08 | Core use case: an organist fits music to a custom printed page **or to an iPad reader app such as forScore**. FIT controls (music size, systems per page) are primary. | User statement 2026-10-08. | User |
| D3 | 2026-10-08 | v1 controls: page size, orientation, margins, music size, systems per page, line breaks, **manual break editing**, sung text size, space between systems. **Deferred:** music-font choice (Bravura) and text-font choice (serif/sans). v1 ships Leipzig and one bundled text face; the controls are not rendered. | User selection. Reviews flagged both font choices as unproven (Verovio text metrics, Bravura PDF). | User |
| D4 | 2026-10-08 | Page sizes are **Print** (Letter, A4, A5) / **iPad** (mini, 11-inch, 13-inch at physical screen size) / **Custom** (90–450 mm per side, ratio ≤ 3). Margins 3–25 mm; default 12 print, 4 iPad/Custom; advisory under 6 mm on print. Preset dimensions provisional until S7. | User selection of the design review's proposal. | User |
| D5 | 2026-10-08 | "Customize export" button renders only when at least one segment on the page has an approved conversion. | Design review §1.8; avoids an elaborate paper picker for scans-only pages. Coordinator default; user may override. | Coordinator |
| D6 | 2026-10-08 | **Pilot:** Kyrie IX (`movement:ordinarium-missae-ix/kyrie`, `vol-5/missa-ix/kyrie_IX.ly`) is the only public pilot. Converter work must also pass fixtures F2–F5 (`PILOT_FIXTURES` in contracts §2): `vol-3/al_ego_dilecto.csv.ly`, `vol-5/missa-ix/agnus_IX.ly`, `vol-5/missa-i/ite_Ib.ly`, `vol-2/co_inclina_aurem_tuam.csv.ly`. G1 cannot pass on Kyrie alone. | Eng review: 857/859 sources carry a hidden `voiceLines` voice, 92 use `\voiceLine`, 45 use `\quil`; Kyrie IX uses none. All five fixtures are matched in `data/typeset/manifest.json`. | User |
| D7 | 2026-10-08 | Container is a full-screen native `<dialog>` with a history entry (Back closes). Not a drawer or route. | Design review §6: selection state lives in page DOM; preview needs the full iPad screen; native dialog gives focus containment. | Coordinator |
| D8 | 2026-10-08 | Verovio runs at `scale: 100`, page in 0.1 mm units; staff `unit` 7/9/12 = 5.6/7.2/9.6 mm. The experiment's `scale: 40` results (incl. "4 + 1 systems on Letter/Large") are not acceptance criteria. | Eng review §2c. | Coordinator |
| D9 | 2026-10-08 | Kyrie IX experiment artifacts are checked in by S0. python-ly `xml-export.ily` (GPL) is **not** vendored (repo is CC0). | Eng review §2a/b. | Coordinator |
| D10 | 2026-10-08 | Execution: Opus coordinates and runs spikes S1–S4, S7; Sonnet and Haiku implement per the execution packet. Gates G0–G4 retained. Escalation checkpoints (not kill switches): if S1 + A2 + A3 together exceed 4 weeks, or S4 exceeds 2 weeks, the coordinator stops and reviews with the user before continuing. | CEO review time-box recommendation, adapted to D1. | Coordinator |
| D11 | 2026-10-08 | Add export analytics (task B0): one GoatCounter event per export recording quick vs custom, page preset, orientation, staff size, systems cap, line policy. No personal data. | CEO review: no demand data exists; informs which presets matter. | Coordinator |
| D12 | 2026-10-09 | No preset for the 10.2-inch iPad (9th gen, 4:3). Those users use Custom (155.9 × 207.8 mm). | S7: it shows at 91.5 % on the 11-inch preset. | User |
| D13 | 2026-10-09 | forScore's default portrait mode is Best Fit, so the iPad preset subtitle "fills the screen in forScore" stays as written. | User confirmation; S7 forScore documentation. | User |
| D14 | 2026-10-09 | **Open:** Verovio licence. The npm package `verovio@6.3.0` (rism-digital) declares LGPL-3.0-or-later; `mei-toolbox/verovio` on GitHub is MIT. Interim plan: ship the unmodified package as its own lazy chunk, with a licence notice and source link in the site credits. | `web/node_modules/verovio/package.json`; rism-digital/verovio `COPYING`. | User (pending) |
| D15 | 2026-10-09 | Pilot fixture F3 becomes `vol-5/missa-xi/agnus_XI.ly` (was `vol-5/missa-ix/agnus_IX.ly`). `agnus_IX.tsv` stays as a supplementary extraction fixture (same-staff voice-line and ordinary glissandi). | S1: `agnus_IX` uses only `\voiceLine "down" "down"`, so it never changes staff; `agnus_XI` has three `\voiceLine "down" "up"` and the only printed accidentals among the fixtures. Matched in `data/typeset/manifest.json`. | Coordinator (within D6) |

## Spike outcomes

_(S0–S7 append here: date, spike, decision, evidence paths, consequences for downstream tasks.)_

### S5: MEI 5.0 schema validator (2026-10-08)
- **Decision:** validate with `lxml.etree.RelaxNG` (lxml 6.1.3, libxml2 2.14.6) against the vendored `data/typeset/mei/schemas/mei-5.0/mei-CMN.rng` (MEI v5.0, ECL-2.0, self-contained: one schema file plus `LICENSE` and `SOURCE.md`). `jing` is not used; Java is also not installed on the dev host. Every file (schema and input) is parsed with `XMLParser(resolve_entities=False, no_network=True, load_dtd=False)`.
- **Evidence:** `docs/superpowers/experiments/s5-schema.md`. The experiment MEI is **valid with 0 errors**; a negative control (`<bogus/>` in `<mdiv>`) is rejected. The same run works with `socket.socket` patched to raise. DOCTYPE, external-entity (file and http) and entity-bomb inputs are rejected with no network use and no expansion.
- **Consequences:** coordinator adds `lxml>=5,<7` to `pyproject.toml`. A3 `validate_schema` **must** reject any DOCTYPE/entity (`docinfo.doctype`, `system_url`, `public_id`; optionally a byte scan for `<!DOCTYPE`/`<!ENTITY`), because RelaxNG validation alone *accepts* documents with unexpanded entity references. Schematron rules embedded in the `.rng` are not enforced by libxml2, so "valid" means RelaxNG-valid only. `SchemaBundle.validator` is `lxml-relaxng 6.1.3` (from `etree.LXML_VERSION`).

### S6: Verovio WASM bundling (2026-10-08)
- **Decision:** `verovio@6.3.0` (exact pin) bundles under the Astro 7 static build with **no Astro or Vite config change**. Import `createVerovioModule` from `verovio/wasm` and `VerovioToolkit` from `verovio/esm`, in a worker created with `new Worker(new URL("../workers/<name>.worker.ts", import.meta.url), { type: "module" })`.
- **Evidence:** `docs/superpowers/experiments/s6-bundling.md`. One new chunk, 8,307,650 B raw (7.92 MiB) and 2,401,338 B gzip (2.29 MiB), against Cloudflare Pages' 25 MiB per-file limit. The WASM is inlined (no `.wasm` file). `grep -rl verovio dist --include='*.html'` finds only the spike page. A Playwright smoke run rendered the Kyrie IX MEI to a 243,744-character SVG in 365 ms (desktop Chromium).
- **Consequences:** the package ships no types, so B4 adds an ambient `web/src/workers/verovio.d.ts` (a draft is in the experiment doc). The `node:module` externalisation warning at build is harmless. The worker call must stay in editor-only code so that ordinary pages never fetch the chunk (B9 asserts this). `check-links.ts` has no exemption for unlinked pages. The licence is LGPL-3.0-or-later (not assessed). iPad Safari needs 15+ for module workers, which the site already requires. iPad cold start and memory are not measured and stay with C2.

### S7 — iPad preset dimensions (2026-10-08)

**Decision:** keep the three iPad presets, one geometry each, matching the current Air/base/mini screens. No class is split.

| Preset | Portrait mm | px @ ppi | Exact on | Worst in-class error |
|---|---|---|---|---|
| `ipad-mini` | 115.9 × 176.6 | 1488×2266 @326 | mini 6th gen, mini (A17 Pro) | none |
| `ipad-11` | 157.8 × 227.1 | 1640×2360 @264 | Air 5/M2/M3/M4, iPad 10th gen, iPad (A16) | Pro 11 M4/M5: aspect 0.81 %, Best-Fit scale +1.7 %, 1.9 mm blank strip |
| `ipad-13` | 197.0 × 262.9 | 2048×2732 @264 | Air 13 M2/M3/M4, Pro 12.9 5th/6th gen | Pro 13 M4/M5: aspect 0.05 %, scale +0.7 % |

**Evidence:** `docs/superpowers/experiments/s7-ipad-presets.md`. It holds the full 2021–2026 model table, sourced from Apple tech-spec pages, and the forScore display-mode documentation.

**Consequences:**
- Contracts `PAGE_PRESETS` is **unchanged**: every value is within 0.5 mm. The contract's mini and 13-inch heights (176.5, 262.8) are truncated, not rounded, by 0.05 mm, which is optional to correct.
- B3a may use the existing presets as final.
- forScore documents "Best Fit" as fitting the page as large as possible without clipping. "Standard Fit" letterboxes to a common aspect ratio. The "fills the screen in forScore" copy therefore holds in Best Fit only. Whether toolbars overlap the page is undocumented, so it needs a real-device check ([U]).
- 10.2-inch iPads (9th gen, 4:3) fall outside every preset; they use Custom 155.9 × 207.8 mm.

### S1: Extraction strategy (2026-10-09)
- **Decision:** extract with an **iteration-time listener**, `pipeline/typeset/mei/listen_full.ily`, extractor version **`listen_full/1`**. It runs via `pipeline.typeset.lilypond.run(..., includes=(INCLUDE, pipeline/typeset/mei))` on a temporary wrapper that defines `listen-full-root`, includes the listener and then includes the unmodified source. **No compiler-tree fallback is needed** for any ScoreIR property of F1–F5, so `xml-export.ily` is not used.
- **Lyric anchoring is exact.** The anchor comes from `associatedVoiceContext`. For every lyric row in all fixtures, a note of the associated layer starts at the same onset.
- **Effective staff** comes from `ly:context-find voice 'Staff` at event time.
- **Grob facts** come from acknowledgers using `ly:grob-property-data`:
  - notehead transparency and stencil, where `\quil` is `ly:text-interface::print`;
  - stem visibility;
  - division kind, from the `eq?` BreathingSign stencil procedure.
- **Evidence:** `docs/superpowers/experiments/s1-extraction.md`.
  - The Kyrie TSV equals `baseline-events.json` on all 4 layers: 358 notes and 5 skips, with every onset, duration and pitch matching.
  - All 82 Kyrie lyrics are anchored to `up:chant`, and there are 3 stanza markers.
  - F3 has `gliss` rows, F4 has a `head … quilisma` row, and F5 has `div maxima` rows.
  - Two runs gave byte-identical TSVs.
  - The raw TSVs are in `tests/fixtures/mei/extraction/`.
- **Contract change (needs coordinator review):** Contracts §4 is rewritten with the final grammar. The change list is at its end:
  - new `version`, `staff`, `voice`, `rhead`, `acc` and `col` rows;
  - `loc` on `head` and `stem`;
  - note fields in IR units.
- **Finding:** F3 (`agnus_IX.ly`) uses only `\voiceLine "down" "down"`, so its effective staff never changes. `tests/fixtures/mei/extraction/agnus_XI.tsv` (three `\voiceLine "down" "up"`, plus printed naturals) is checked in as supplementary proof of cross-staff and `acc` rows. The coordinator decides whether it becomes a pilot fixture.
- **Consequences:**
  - A2a wraps the runner above and checks the `version` row.
  - A2b keys `head`/`stem`/`acc` rows by (onset, layer, loc), not adjacency, and dedupes `key` rows (one per voice).
  - A2b derives rest/skip `notated` from `dur`, and fails on `main@grace` onsets.
  - A2c derives `LayerRole` from lyric association and hidden heads.

### S3: text face (2026-10-09)

**Decision:** one text face, **Liberation Serif 2.1.5 (OFL-1.1)**. Regular is the lyric face and the heading regular; Italic and Bold are the heading italic and bold. The fonts go in `web/public/fonts/export/` with the OFL text beside them.

**Files and hashes:** `LiberationSerif-Regular.ttf` `058ea808…fb74`, `-Italic.ttf` `0e3dea9f…2fc2e`, `-Bold.ttf` `d754ba42…d5ce`. Full hashes and the source URL are in the experiment doc. The files are staged in `build/s34-fonts/`.

**Evidence:** `docs/superpowers/experiments/s3-s4-fonts-pdf.md`.
- Verovio 6.3.0 has no text-font option. `fontAddCustom` is for music fonts only.
- It measures text with built-in Times New Roman tables (`data/text/Times*.xml`).
- `fontTextLiberation` changes 0 of 685 element geometries. It only embeds about 390 KB of woff2 per SVG, so it stays off.
- Liberation Serif is metric-identical to Times New Roman. 80 of 94 ASCII regular advances match Verovio's table exactly. The 14 that differ are capitals and `w`, by at most 0.067 em, because Verovio uses bbox widths where its table lacks an advance.

**Consequences:**
- Verovio measures **every non-ASCII character as 0.5 em** (an upstream bug: its Latin-1 rows are keyed by UTF-8 bytes). ǽ and œ therefore draw up to 0.22 em wider than the space reserved for them, and í narrower. Preview and PDF still agree, because both draw at Verovio's `x` with the same face.
- The preview must render SVG text in the bundled face. B5 or B8a rewrites `font-family="Times, serif"` and the page loads the face with `@font-face`. It must never fall back to the system Times.
- `FontProfile` is **unchanged**.

### S4: vector PDF route (2026-10-09)

**Decision:** route **(ii)**, `pdf-lib` plus `@pdf-lib/fontkit@1.1.1` plus our walker over Verovio's SVG subset. The prototype is `web/scripts/spike-pdf/walker.ts` + `xml.ts`. The coordinator adds `@pdf-lib/fontkit` `1.1.1` (exact) and, suggested, pins `pdf-lib` to `1.17.1`. No other dependency is needed. pdfkit, svg-to-pdfkit and fontkit 2 are rejected.

**Evidence** (experiment doc; ipad-11 page, primary and accented Kyrie at `scale:100`, plus the `scale:40` fixture on A4):

| Measure | Route (ii) | Route (i) |
|---|---|---|
| MediaBox | 447.30709 × 643.74803, error 0 | error 5e-7 pt |
| Image XObjects | 0 | 0 |
| `<use>` resolved | 197/197 and 384/384 | no warnings |
| Paint ops vs SVG drawables | 649/649 and 1272/1272 | 649/649 and 1272/1272 |
| Fonts in the PDF | Liberation subsets only; no music font | same |
| Accented syllables and heading | extractable by pdf.js | extractable by pdf.js |
| Misplaced ink at 288 dpi | 0 px | 0 px only with a stroke pre-pass; 51 % without one, because svg-to-pdfkit ignores Verovio's `stroke:currentColor` stylesheet |
| Module worker | runs, 56–79 ms/page | ESM build runs; standalone fails (`Dynamic require of "url"`) |
| gzip chunk | 549,661 B | 235,667 B (ESM) |

**Why (ii) despite the larger chunk:**
- B6b's `embedPdf` for fixed pages requires pdf-lib, and pdfkit cannot import existing PDF pages.
- The walker has a closed input surface.
- svg-to-pdfkit has had no release since 2019.

**Consequences:**
- G2 is not at risk.
- The 550 KB gzip chunk loads only at export time, in the PDF worker. An adapter onto `fontkit@2.0.4` (measured: 333 KB gzip, same output) is an option if size matters later.
- pdf-lib is dormant (last release 2021). Accept this, because quick export already depends on it.
