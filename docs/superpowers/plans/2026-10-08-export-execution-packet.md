# Export Layout — Execution Packet (task cards for Sonnet/Haiku, coordinated by Opus)

Date: 2026-10-08. Status: **ready for approval**. This packet replaces the 20 tasks in Plans A/B/C with 60 single-session task cards. Plans A/B/C remain the rationale and background; **where a card and a plan disagree, the card wins.**

## 0. Read this first

| Short name | Document | Role |
|---|---|---|
| **Spec** | [specs/2026-10-06-export-layout-editor-design.md](../specs/2026-10-06-export-layout-editor-design.md) | What and why |
| **UI** | [specs/2026-10-08-export-editor-ui-spec.md](../specs/2026-10-08-export-editor-ui-spec.md) | Screen, states, copy, break editing, accessibility |
| **Contracts** | [plans/2026-10-08-export-contracts.md](2026-10-08-export-contracts.md) | Frozen TS/Python types, mapping rules, review matrix, TSV grammar |
| **DL** | [plans/export-layout-decisions.md](export-layout-decisions.md) | Settled decisions (D1–D11) and spike outcomes |
| **P0 / PA / PB / PC** | Coordination plan and Plans A, B, C | Background, rationale, gates |
| Reviews | `docs/superpowers/reviews/2026-10-08-export-{ceo,design,eng}-review.md` | Evidence for the above; do not implement from these directly |

**Settled; do not reopen** (DL): MEI/Verovio reflow is v1 (D1). The iPad/forScore use case (D2). No font-choice controls in v1 (D3). Print / iPad / Custom page sizes (D4). Kyrie IX is the public pilot, plus fixtures F1–F5 (D6). Verovio runs at `scale: 100` (D8).

### 0.1 Model routing

| Tag | Model | Gets |
|---|---|---|
| **[O]** | Opus (coordinator session or Opus subagent) | Spikes, design notes, integration of coordinator-owned files, release |
| **[S]** | Sonnet | Bounded implementation against frozen contracts, with a fixture and done-criteria |
| **[H]** | Haiku | Mechanical tasks: pasting given types, fixture copying, small pure functions with exhaustive tests, CLI wiring |
| **[U]** | User | Approvals (G0, G1 signature, G4) and real-device checks |

Haiku never edits a validator, oracle, sanitizer, publisher or security boundary (A4a/A4b, B5, C1). An [S] or [H] card that hits its **Escalate if** condition stops and reports. It does not weaken a check, skip a test or widen scope. The coordinator then re-runs the card on Opus **with the failing evidence**, not the whole lane.

### 0.2 Protocol for every card

1. The coordinator creates a worktree from the lane's last accepted commit:
   ```bash
   git worktree add .claude/worktrees/<card-id> -b export/<card-id> <base>
   ```
2. The coordinator dispatches the implementer with the **prompt template** (§0.4). The implementer reads only §0 of this packet, its own card, and the documents its card lists under **Read**.
3. The implementer follows TDD: write the failing tests from **Done when**, run them and see them fail for the expected reason, implement, then run them and see them pass. A syntax error, a missing tool or a skipped `lilypond` test is **not** valid red/green evidence.
4. The implementer commits with the card's message (plus the attribution trailer) and returns a handoff:
   - commit SHA;
   - files changed;
   - exact commands with exit codes;
   - artifact paths;
   - open risks.
5. An independent reviewer (fresh session, [S] unless the card says otherwise) gets the card, the diff and the handoff. It returns `accept`, `changes required` or `blocked`. The reviewer never fixes code itself.
6. The coordinator merges accepted cards **serially** into `export/integration`, re-runs the lane's test commands, and updates the card's status in §6.

**Standard commands**
- **PY:**
  ```bash
  uv run pytest -q <test files>
  uv run ruff check pipeline tools tests
  ```
  The dev dependency group is installed by plain `uv sync`; there is no `--extra`.
- **PY-LILY:** `uv run pytest -q <files> -m lilypond`. This needs the pinned LilyPond (`uv run noh lilypond-install`). A skip is **not** a pass.
- **WEB:**
  ```bash
  cd web && pnpm exec vitest run <test files> && pnpm typecheck
  ```
- **WEB-BUILD:**
  ```bash
  cd web && PUBLIC_ASSET_BASE=/systems pnpm build
  ```
  `web/.env` is a 1Password pipe agents cannot read, so they set the variable explicitly. Never commit `web/.env`.
- **E2E:** `cd web && pnpm test:e2e -- export-layout`. Playwright has only a Desktop Chrome project. Narrow screens use `test.use({ viewport: { width: 390, height: 844 } })` inside the spec file.

**Repository rules (all cards):**
- Follow `.claude/rules/security.md`. The repo has no `AGENTS.md`.
- No `any`, no `eval`/`new Function`, no secrets, and no absolute developer paths in committed files.
- Generated output goes under `build/`, which is never committed.
- Do not touch quick export (`web/src/lib/pdf.ts`, `web/src/workers/pdf.worker.ts`) unless the card says so.

### 0.3 File ownership

**Coordinator-owned [O] files.** Other cards propose changes to these in their handoff and never edit them:
- `web/src/components/ExportBar.astro`
- `web/src/lib/typeset.ts`
- `web/package.json`, `pnpm-lock.yaml`
- `pyproject.toml`, `uv.lock`
- `pipeline/cli.py`
- `.github/workflows/*`
- `web/src/styles/tokens.css`, `web/src/styles/base.css`
- `data/typeset/mei/manifest.json`

**Lane ownership.** Only one card per lane runs at a time:

| Lane | Owns |
|---|---|
| **PY** | `pipeline/typeset/mei/**`, `tests/test_mei_*.py`, `tests/fixtures/mei/**`, `data/typeset/mei/{schemas,profiles,reviews}/**` |
| **W1** (layout) | `web/src/lib/export-layout/{types,settings,capabilities,selection,breaks,paginate,layout,meiDoc,svg}.ts` + tests, `web/src/lib/mei.ts`, `web/src/lib/exportSelection.ts` |
| **W2** (PDF) | `web/src/lib/export-layout/{fonts,vectorPdf,compose,exportPdf,fixedPreview}.ts` + tests, `web/public/fonts/export/**` |
| **W3** (UI) | `web/src/lib/export-layout/{controller,preferences,limits}.ts` + tests, `web/src/workers/export-layout*.worker.ts`, `web/src/components/ExportLayout*.astro`, `web/src/scripts/exportLayout.ts`, `web/e2e/export-layout.e2e.ts` |
| **DOC** | `docs/superpowers/**` |

### 0.4 Prompt templates

**Implementer**

> You are implementing card **{ID}** of `docs/superpowers/plans/2026-10-08-export-execution-packet.md`, in worktree `{path}` on branch `export/{ID}` from base `{sha}`. Read §0 of that packet, card {ID}, and only the documents its **Read** line lists. You own only the files in the card's **Files** line. Write the **Done when** tests first and run them to see them fail for the stated reason. Then implement and re-run. Follow `.claude/rules/security.md`. Do not reopen decisions in `export-layout-decisions.md`. If you hit the card's **Escalate if** condition, stop and report a minimal reproduction; do not weaken checks. Commit with the card's commit message, ending with the attribution trailer. Reply with: commit SHA, files changed, every command run with its exit code, artifact paths, and remaining risks.

**Reviewer**

> Independently review card **{ID}** (packet §{n}) at diff `{base}..{head}`. Read the card, its **Read** documents and the diff only. Run the card's **Done when** commands yourself. Check especially: {card's Review focus, or "contract conformance and test meaningfulness"}. Report findings with file:line and a reproduction. Return `accept`, `changes required` or `blocked`. Do not fix the code.

---

## 1. Spikes (run first; each appends its outcome to DL before any dependent card starts)

### S0 [H] Check in the experiment fixtures — lane DOC/PY — depends: none
**Read:** eng review §2b.
**Source:** `~/.codex/visualizations/2026/10/06/01a10f81-7606-7733-b9d5-b66fceed337e/kyrie-ix-experiment/` (the coordinator gives the absolute path in the prompt).

**Files:**

| Destination | Content |
|---|---|
| `docs/superpowers/experiments/kyrie-ix/README.md` | Copied, then edited |
| `docs/superpowers/experiments/kyrie-ix/convert.py` | Copied. Add a first-line comment: `# REFERENCE ONLY. Line-number voice selection and the slur/lyric heuristic are forbidden in production (PA Global Constraints).` |
| `tests/fixtures/mei/kyrie-ix/experiment-validation.json` | Copy of `validation.json` |
| `tests/fixtures/mei/kyrie-ix/experiment.mei` | Copy of `kyrie-ix.mei` |
| `web/src/lib/export-layout/__fixtures__/kyrie-ix-experiment.mei` | Copy of `kyrie-ix.mei` |
| `web/src/lib/export-layout/__fixtures__/kyrie-ix-verovio-page1.svg` | Copy of `mei-1.svg` |
| `docs/superpowers/mockups/export-layout/assets/kyrie-ix-mei-page1.svg` | Copy of `mei-1.svg` |
| `docs/superpowers/mockups/export-layout/assets/kyrie-ix-lilypond.svg` | Copy of `lilypond.svg` |
| `tests/fixtures/mei/kyrie-ix/baseline-events.json` | Derived from `lilypond-resolved.xml` by a one-off script under `build/` (not committed). Format: `{"voices": {"<line>": [{"onset":"0/1","duration":"1/8","kind":"note","step":"g","alter":"0/1","octave":4}, ...]}}`, with onsets accumulated per Voice exactly as `convert.py` does |

**Steps:**
1. In README.md, add a **Provenance** section:
   - ly-to-musicxml at commit `5adbd4d9864ad18368ecb2e4909782ab4bbfd258` (MIT);
   - python-ly `xml-export.ily` (GPL), **not vendored**;
   - Verovio `6.3.0-425dd7b`;
   - date 2026-10-06;
   - "produced with `scale: 40`; physical sizes are not representative (DL D8)".
2. Replace every `/private/tmp/...` and `/Users/...` path in README.md with a placeholder.
3. Do not commit `lilypond-resolved.xml`, `kyrie-ix.musicxml`, `musicxml-*`, `comparison*.html` or `build_comparison.py`.

**Done when:**
- `grep -rln '/Users/\|/private/tmp' $(git show --name-only --format= HEAD)` prints nothing (every committed file, including SVG `textedit://` links).
- `baseline-events.json` has 4 voices with 180/61/61/61 events.
- The note-event count across all voices is 358, plus 5 skips.
- Each voice's durations sum to `373/8`.

**Commit:** `test: check in Kyrie IX experiment fixtures with provenance`
**Escalate if:** the counts differ from `experiment-validation.json`.

### S1 [O] Extraction strategy and full listener — lane PY — depends: S0
**Read:** eng review §2a and §4 (S1). Contracts §2 and §4. `pipeline/typeset/listen.ily`, `pipeline/typeset/events.py`, `pipeline/typeset/lilypond.py:144` (`run`), `data/typeset/include/noh2.ily`.

**Question:** can an iteration-time listener give every `ScoreIR` property for F1–F5? Specifically:
- the lyric anchor via `associatedVoiceContext`;
- the effective staff after `\change Staff` (used by `\voiceLine`);
- head and stem transparency and the quilisma stencil via acknowledgers;
- the division kind via the `BreathingSign` stencil procedure name.

**Files:**
- `pipeline/typeset/mei/__init__.py` (empty)
- `pipeline/typeset/mei/listen_full.ily` (new; do **not** modify `pipeline/typeset/listen.ily`)
- `tests/fixtures/mei/extraction/{kyrie_IX,al_ego_dilecto.csv,agnus_IX,ite_Ib,co_inclina_aurem_tuam.csv}.tsv`
- `docs/superpowers/experiments/s1-extraction.md`

**Done when:**
1. The five TSVs are produced by `lilypond.run(..., includes=(INCLUDE, MEI_DIR))` inside the existing sandbox.
2. Every row matches the Contracts §4 grammar (finalise the grammar in this spike and update Contracts §4 if needed; that is a coordinator-reviewed contract change).
3. In the Kyrie TSV:
   - every `lyric` row's `<assoc-layer>` is the chant layer;
   - per-layer note onsets and pitches equal `baseline-events.json`;
   - there are 3 stanza markers.
4. In the F3 TSV, `gliss` rows appear and note rows show the effective staff changing.
5. The F4 TSV has `head … quilisma`.
6. The F5 TSV has `div maior` and/or `div maxima`.
7. DL gets an S1 entry giving the decision, any property that needs a compiler-tree fallback (with a fixture), and the extractor version string.

**Escalate to user if:** lyric anchoring cannot be made exact for any fixture. G1 depends on it.

### S2 [O] Verovio layout behaviour and the two-pass algorithm — lane W1 — depends: S0, S6
**Read:** eng review §4 (S2), §6 (B4a) and §7 risks 1, 2, 6, 7. Contracts §1.1.

**Verify, on Verovio npm 6.3.0 in Node:**
- every option name in Contracts §1.1;
- that `unit` 9 at `scale: 100` gives a 7.2 mm staff (measure the SVG);
- the behaviour of `breaks: line | auto | encoded`;
- whether `systemMaxPerPage` is honoured under each `breaks` value;
- whether `<sb>`/`<pb>` are honoured under `encoded`;
- `justifyVertically`;
- how to read system geometry: `g.system` bbox plus the first `measure` id;
- whether pass 2 (`encoded`) reproduces pass 1's line breaks.

Repeat with the experiment MEI and with a voice-line glissando: hand-edit a copy of the experiment MEI with a `<gliss>` between `@visible="false"` notes.

**Files:**
- `web/scripts/spike-verovio.ts` (kept as a dev harness)
- `web/src/lib/export-layout/__fixtures__/s2-pass1-letter-medium.json` (measured systems)
- `docs/superpowers/experiments/s2-verovio.md`

**Done when:**
- There is an option table with the verified behaviour of every option.
- The two-pass algorithm is confirmed, or replaced with a pseudocode alternative.
- The glissando renders acceptably, or is recorded as `UNSUPPORTED` (that blocks G1 for F3; tell the user).
- There is a determinism note: whether the Python `verovio` wheel's SVG equals the WASM SVG. If not, all evidence renders via Node.
- DL has an S2 entry.

### S3+S4 [O] Text face and vector PDF route — lane W2 — depends: S0, S6
**Read:** eng review §4 (S3, S4) and §7 risks 3, 5. DL D3 (one text face). Contracts §1 `FontProfile`. `web/src/lib/pdf.ts:67` (`pdfSafe`, the WinAnsi-lossy sanitizer that must **not** be reused).

**S3 (text face):** determine which face Verovio uses to measure `<syl>` text.
- Choose one bundled, licence-compatible text face whose metrics match Verovio's layout, for lyrics.
- Choose the heading regular, italic and bold faces (they may be the same family).
- Confirm accented Latin (é, á, ǽ, œ) renders in both preview and PDF.

**S4 (vector PDF):** build two prototypes and compare them on the Kyrie page SVG and on a 157.8 × 227.1 mm page:
- (i) `pdfkit` standalone + `svg-to-pdfkit` in a Vite module worker;
- (ii) `pdf-lib` + `@pdf-lib/fontkit` + a walker over Verovio's SVG subset (`svg, g, path, use, symbol, defs, rect, polyline, polygon, ellipse, text, tspan`) using `drawSvgPath`.

Compare: page size within 0.05 pt, no raster images, glyph `<use>` resolution, accented text, gzip chunk size, and maintenance status.

**Files:** `docs/superpowers/experiments/s3-s4-fonts-pdf.md`, prototype code under `web/scripts/spike-pdf/` (not shipped), and font files staged under `build/`.

**Done when:** DL has S3 and S4 entries recording:
- the chosen adapter and pinned versions, for the coordinator to add to `web/package.json`;
- the font files with SPDX licences and sha256;
- the destination `web/public/fonts/export/`;
- the measured chunk sizes;
- proof screenshots or PDF hashes.

**Escalate to user if:** neither route preserves glyphs as vectors. That is gate G2 at risk, and DL D1 names the fallback.

### S5 [S] MEI schema validator — lane PY — depends: S0
**Read:** eng review §4 (S5). PA A3 bullet about schema pinning.

**Task:** vendor the MEI 5.0 RelaxNG (`mei-CMN.rng` and its dependencies) to `data/typeset/mei/schemas/mei-5.0/`, together with `SOURCE.md` (URL, version, licence, sha256 of each file). Validate the experiment MEI using:
- (a) `lxml.etree.RelaxNG`, with `resolve_entities=False` and `no_network=True`;
- (b) `jing`, only if (a) cannot load the schema.

**Done when:**
- `docs/superpowers/experiments/s5-schema.md` records the validator, the pass/fail result and any errors on the experiment MEI.
- DL has an S5 entry.
- The coordinator is told the dependency to add (e.g. `lxml>=5`).

**Escalate if:** neither validator handles the schema without network access.

### S6 [S] Verovio WASM bundling in Astro — lane W1 — depends: none
**Read:** eng review §4 (S6) and §7 risk 4. `web/astro.config.*`, `web/src/workers/pdf.worker.ts` (existing worker pattern).

**Task:** on a throwaway branch, add `verovio@6.3.0` (exact pin) and create `web/src/workers/spike-verovio.worker.ts`, loaded with `new Worker(new URL('../workers/spike-verovio.worker.ts', import.meta.url), { type: 'module' })`. It renders the experiment MEI and posts the SVG length.

**Done when:**
- WEB-BUILD succeeds.
- Every chunk is under 25 MiB (the Cloudflare Pages per-file limit).
- `grep -rl verovio web/dist/**/*.html` prints nothing; only the JS chunk references it.
- A Playwright smoke run loads the worker and receives the SVG.
- `docs/superpowers/experiments/s6-bundling.md` records the import snippet, chunk sizes and the iPadOS module-worker requirement (15+).
- DL has an S6 entry.
- The throwaway branch is not merged; the coordinator re-applies the dependency in B4d.

### S7 [O] iPad preset dimensions — lane DOC — depends: none
**Task:** from Apple's current tech-spec pages, record for each preset (mini, 11-inch, 13-inch) the device generations it covers, native pixels and ppi, then compute portrait mm (`px / ppi × 25.4`, 0.1 mm). Choose one value per preset; prefer the current generation and note the aspect error for older ones. Optionally check how forScore fits a PDF page (fit-width vs fit-page) from its documentation.

**Done when:** DL has an S7 entry, and Contracts `PAGE_PRESETS` is updated (a coordinator contract change) if any value differs by more than 0.5 mm.

---

## 2. Python lane (PY): conversion — Plan A

### A1a [H] Python contracts — depends: S0
**Read:** Contracts §2.

**Files:** `pipeline/typeset/mei/{diagnostics,model}.py` (paste Contracts §2 and implement the bodies) and `tests/test_mei_model.py`.

**Done when:**
- `rational_to_str(Fraction(14,16)) == "7/8"`, `rational_to_str(Fraction(0)) == "0/1"` and `rational_to_str(Fraction(3)) == "3/1"`.
- `rational_from_str` raises `ValueError` for `"0.5"`, `"7/8.0"` and `"14/16"`.
- A hand-built 3-event `ScoreIR` round-trips: `ScoreIR.from_dict(ir.to_dict()) == ir`.
- `json.dumps(ir.to_dict(), sort_keys=True)` is byte-stable across two calls.
- `BLOCKING` contains every error-severity code except `GEOMETRY_*`, enumerated explicitly.
- `PILOT_FIXTURES` has the five paths.
- PY passes.

**Commit:** `feat(mei): define exact conversion contracts`

### A1b [S] Catalogue audit — depends: A1a
**Read:** Contracts §2 (`SourceRecord`, `AuditReport`), PA A1, `pipeline/typeset/render.py:81` (`source_hash`), `data/typeset/parts.yml`, `data/typeset/manifest.json`.

**Files:** `pipeline/typeset/mei/audit.py` and `tests/test_mei_audit.py` (tmp-dir fixtures, no LilyPond).

**Interface:** `audit_sources(root: Path, targets: list[dict], include_dir: Path) -> AuditReport`.

**Done when** these tests pass:
- `test_dependency_change_changes_digest` (editing a copied `noh2.ily` changes every digest);
- `test_absent_target_is_not_a_failure` (a target in `parts.yml` with no file lands in `absent_targets`, not `sources`);
- `test_unknown_include_reports_location` (`\include "other.ily"` on line 2 gives `UNKNOWN_INCLUDE` with that location);
- `test_feature_text_scan` (counts for `\voiceLine "`, `\quil`, `\divisioMinima`/`\quarterBar`, `\divisioMaior`/`\halfBar`, `\divisioMaxima`/`\singleBar`, `\set stanza`, `\forceBreak`, and `voiceLines`).

Text-scan counts are classified as candidates only. Remove the old PA assertion `empty_record.state == "absent"`: no source is empty. PY passes.

**Commit:** `feat(mei): audit conversion sources and feature families`

### A1c [H] Audit CLI and report — depends: A1b; the coordinator merges the `pipeline/cli.py` line
**Files:**
- `pipeline/typeset/mei/cli.py` (`typeset-mei-audit --out PATH`);
- a proposed one-line dispatch for `pipeline/cli.py`, given in the handoff;
- `docs/superpowers/plans/export-layout-audit-2026-10.md` (counts only).

**Done when:**
- `uv run noh typeset-mei-audit --out build/typeset/mei/audit.json` lists 859 sources.
- The report has family counts and `proposed_pilot == PILOT_FIXTURES`.
- `uv run pytest -q tests/test_cli.py tests/test_cli_commands.py` passes.

**Commit:** `feat(mei): add catalogue audit command and report`

### A2a [S] Production listener runner — depends: S1, A1a
**Read:** DL S1 entry, Contracts §4, `pipeline/typeset/lilypond.py:144`.

**Files:** `pipeline/typeset/mei/listen_full.ily` (promoted from S1), `pipeline/typeset/mei/extract.py::run_listener(source: Path, runner: LilyPondRunnerAdapter) -> str`, and `tests/test_mei_extract.py` (marked `lilypond`).

**Done when:** PY-LILY shows that the TSV for each of F1–F5 equals the checked-in TSV byte for byte.

**Escalate if:** the TSV output is nondeterministic.

### A2b [S] TSV to staves, layers and events — depends: A2a (or S1's TSVs alone)
**Files:** `extract.py::parse_rows`, `build_staves`, `build_layers`, `build_events`, and tests (no LilyPond; use the S1 TSVs).

**Done when:**
- Kyrie `[l.id for l in ir.layers] == ["up:chant","up:#1","down:#2","down:#3"]` and `[l.voice_command …] == ["voiceOne","voiceTwo","voiceOne","voiceTwo"]`.
- Per-layer `(onset, duration, pitch)` equals `baseline-events.json`.
- `total_duration == Fraction(373, 8)`.
- 358 notes and 5 skips.
- F2 has a 5th layer with `role == "voice-line"` and every `notehead == "hidden"`.
- F3 events have `staff_id != home_staff_id` where `\change Staff` applies.
- No float appears anywhere (add a test that greps `extract.py` for `float(`).

**Escalate if:** any voice cannot be identified without source line numbers.

### A2c [S] Lyrics, entry markers, spans, divisions — depends: A2b
**Done when:**
- Kyrie has 82 syllables, 60 of them non-blank.
- Every `anchor_event_id` is an `up:chant` event with an equal onset, and **never** an accompaniment event sharing that timestamp (an explicit test).
- There are 3 entry markers (`*`, `*`, `**`) on the right syllables.
- There are 22 divisions (18 `finalis`, 4 `minima`).
- F4 has a `quilisma` notehead.
- F5 has `maior`/`maxima` divisions.
- Ties and slurs become `Span`s, and repeated attacks stay separate events (an explicit test).

**Escalate if:** any syllable is `LYRIC_UNANCHORED` on F1–F5.

### A2d [S] Boundaries and `after_text` — depends: A2c
**Done when:**
- Kyrie source breaks map to boundaries at onsets `7, 109/8, 85/4, 233/8, 38`.
- A boundary inside a slur is `safe=False, reason="slur-crosses"`.
- A boundary crossing an F3 glissando is `voice-line-crosses`.
- A boundary that is not a common onset across all layers is `not-common-onset`.
- `after_text` is the joined last word before each boundary (Kyrie b001 ends "eléison" or as printed).
- IDs are `b000…` in onset order.

### A2e [H] Extract CLI — depends: A2d
**Done when:** `typeset-mei-extract SOURCE --out DIR` writes `ir.json` (to_dict, sorted) and `events.tsv` under `build/typeset/mei/<digest>/`, and a CLI test passes with the fake runner.

### A3a [S] Schema validation — depends: S5, A1a
**Files:** `pipeline/typeset/mei/schema.py::validate_schema(xml: bytes, schema: SchemaBundle) -> list[Diagnostic]` and `tests/test_mei_schema.py`.

**Done when:**
- The experiment MEI gives the result DL S5 recorded.
- A document with a DOCTYPE or external entity gives `SCHEMA_INVALID` with no network access (assert with a socket-blocking fixture).
  - **RelaxNG alone accepts such documents** (DL S5). `validate_schema` must:
    - byte-scan the input for `<!DOCTYPE` / `<!ENTITY` before parsing;
    - parse with `XMLParser(resolve_entities=False, no_network=True, load_dtd=False)`;
    - reject when `docinfo.doctype`, `system_url` or `public_id` is non-empty.
  - Test all four of S5's hostile documents (external DTD, file entity, http entity, entity bomb). Each returns a `SCHEMA_INVALID` Diagnostic and never raises.
- The bundle sha256 is checked at load. It covers `mei-CMN.rng` alone, per S5. The validator string is `f"lxml-relaxng {'.'.join(map(str, etree.LXML_VERSION[:3]))}"`.
- "Valid" means RelaxNG-valid only: libxml2 ignores the embedded Schematron rules. Note this in the module docstring.

### A3b [O→H] Feature profile — depends: S1, S2
1. **[O]** writes the mapping table: one `FeatureRule` per `FEATURE_FAMILIES` entry, using S2's render results. For example: finalis → `measure@right="dbl"`; minima/maior/maxima → `<breath>` + `@type`, or engraving-only; quilisma → `@head.shape` or `unsupported`; voice-line glissando → `<gliss>` between `@visible="false"` notes, or `unsupported` per S2; scaled durations → a hidden `<tuplet>` as in the experiment.
2. **[H]** transcribes the table into `data/typeset/mei/profiles/accompaniment-v1.json` and adds a load test.

**Done when:** `ConversionProfile.load` round-trips and every family has exactly one rule.

### A3c [S] Encoder core — depends: A2d, A3a, A3b
**Read:** Contracts §2 (`EncodedScore`), PA A3, the experiment MEI (structure reference only).

**Files:** `pipeline/typeset/mei/encode.py` and `tests/test_mei_encode.py`.

**Done when:**
- F1–F5 encode deterministically (byte-identical across two runs).
- Each output is schema-valid.
- `xml:id` equals the IR event id.
- Lyrics are `<verse place="above">`.
- `<sb>` appears at source breaks.
- Measures are bounded by common onsets with invisible barlines except at divisions, and there is no `meterSig`.
- Scaled durations use hidden tuplets with exact totals.
- Any family whose profile status is `unsupported` emits `UNSUPPORTED_FEATURE` with its source location and the score is not eligible.
- `EncodedScore.boundaries` carries `after_text`.

**Escalate if:** a schema error has no clear fix in the profile.

### A3d [S] Tie-splitting at boundaries — depends: A3c
**Done when:**
- Splitting a `7/8` sustain into `3/8 + 1/2` keeps one attack and the normalised `7/8` (PA A3 assertions).
- A boundary whose split cannot preserve a tie, lyric or glissando is `UNSAFE_BOUNDARY` and is excluded from the manifest's safe boundaries.

### A3e [S] Convert CLI and Node render harness — depends: A3d, S2
**Files:** `typeset-mei-convert SOURCE --out DIR` (extract plus encode, with no approval side effects) and `web/scripts/render-mei.ts` (renders an MEI file with npm Verovio at a `LayoutCase` and writes SVGs; it uses WASM per S2's determinism note).

**Done when:** F1–F5 convert and render at `letter-p-orig`.

### A4a [S] Independent MEI reader — depends: A3c
**Files:** `pipeline/typeset/mei/normalize.py` (`normalize_ir`, `normalize_mei`) and tests.

**Done when:**
- Tied fragments merge only for proven splits.
- A test asserts `normalize.py` does not import `encode` (parse its AST imports).
- `normalize_mei(experiment_or_A3_output)` yields per-layer sequences equal to `normalize_ir(ir)`.

Not Haiku.

### A4b [S] Semantic comparison — depends: A4a
**Files:** `validate.py::compare_scores` and the `typeset-mei-validate DIRECTORY` CLI.

**Done when:**
- F1–F5 A3 outputs give `semantic_differences == []`.
- The codes match the Contracts §2 list.
- Every difference carries its `source_event_ids`.

Not Haiku.

### A4c [S] Mutation suite — depends: A4b
**Files:** `tests/test_mei_validate.py`: 14 mutation functions on the Kyrie MEI using ElementTree, one per PA A4 mutation, each asserting exactly one expected code. Add a valid tied-split equivalence test and overlap/gap tests.

**Done when:** every mutation fails with its code and the unmutated file passes.

**Review focus:** whether any mutation passes for the wrong reason.

### A5a [S] Review state machine — depends: A4b
**Files:** `review.py` (`apply_review`, `approval_is_current`, `ReviewBlocked`), `REQUIRED_MATRIX` (exactly Contracts §3) and tests (PA A5 list).

**Done when:**
- Approval is blocked by `UNSUPPORTED_FEATURE`, a failed schema, a failed semantic check, or a missing matrix case.
- Changing any `ConversionInputs` field invalidates approval.
- Approval never touches proofreading data.

### A5b [S] Evidence packet — depends: A5a, A3e
**Files:** `evidence.py` and the `typeset-mei-evidence DIRECTORY` CLI.

The packet is HTML with, per `LayoutCase`:
- the LilyPond SVG (existing `render.py` output);
- the MEI SVG (from `render-mei.ts`);
- scan context via `pipeline.typeset.proofread.scan_span(piece, target)`;
- the diagnostics list.

It is written to `build/typeset/mei/<digest>/evidence/`.

**Done when:** the F1 packet has 13 cases × 1 fixture, each with all three panes or a "no scan" note.

### A5c [S] Geometry checks — depends: A5b
**Done when:**
- Any glyph bbox outside the SVG viewBox gives `GEOMETRY_CLIPPING`.
- Overlapping lyric `<text>` bboxes give `GEOMETRY_COLLISION`.
- Both are flags only; a test proves they never set `eligible`.

### A5d [U] Visual review — depends: A5c, B2 (font proof)
The user reviews the F1–F5 packets, records accepted engraving differences, and signs `data/typeset/mei/reviews/<digest>.json` via `typeset-mei-review`. **This is the G1 signature.** The coordinator commits it separately from code.

### A6 [S] Manifest builder — depends: A5a (a fixture record is fine before A5d)
**Read:** PA A6, Contracts §2 (`ManifestPart`), §1 (`ConversionManifestPart`).

**Files:** `manifest.py`, `typeset-mei-manifest --records DIR --out FILE`, tests, and `web/src/lib/export-layout/__fixtures__/manifest.fixture.json` (Kyrie with the **experiment** MEI, labelled unapproved, for web lanes).

**Done when:**
- Stale, unmatched, target-hash-mismatched and corrupted records are excluded.
- `renderHash` is copied verbatim (32 hex) from `data/typeset/manifest.json`.
- `uv run noh typeset-check` passes, and `tests/test_cli.py` and `tests/test_cli_commands.py` pass.

---

## 3. Web lanes: editor and PDF — Plan B

### B0 [H] Export analytics — lane W3 — depends: none (coordinator merges `ExportBar.astro` part)
**Read:** DL D11, `web/src/components/Layout.astro:126`, the ExportBar export handler.

**Files:** `web/src/lib/exportAnalytics.ts::trackExport(kind: 'quick'|'custom', details: Record<string,string>)` plus a test, and a proposed call-site diff for the coordinator.

It calls `window.goatcounter?.count({ path: 'export/' + kind, title: <details joined>, event: true })` inside try/catch and sends no personal data. For quick export the details are `{ paper }`; custom adds page preset, orientation, staff, cap and line policy.

**Done when:** the test passes with `window.goatcounter` both present and absent, and nothing throws.

### B1 [S] Mockups for approval (gate G0) — lane DOC — depends: S0
**Read:** **UI (all)**, `web/src/styles/tokens.css`, `base.css`, `ExportBar.astro`.

**Files:**
- `docs/superpowers/mockups/export-layout/editor.html`: self-contained; tokens.css and base.css copied inline at build of the mockup; uses the S0 SVG assets labelled "Simulated layout".
- `README.md` with a scenario checklist.
- Screenshots at 1280×800, 768×1024 and 390×844.

**Scenarios, each reachable by a scenario switcher:**
1. Kyrie ready (Letter, Medium, as many as fit).
2. iPad 11-inch portrait with 4 mm margins.
3. Custom 160 × 230 mm.
4. Mixed customizable, scan and fixed parts.
5. A blank-page note.
6. Break-editing mode with the menu open.
7. An impossible layout with suggestion buttons.
8. Updating.
9. A global error with "Use original layout".
10. Continuous view.
11. Blocked storage.
12. Stale anchors.
13. Narrow-screen collapsed groups.

**Done when:**
- All 13 scenarios render.
- Keyboard order matches UI §5.
- Every target is ≥ 44 px (verify with a Playwright script in the mockup folder).
- No box-shadow, gradient or radius > 2 px appears (grep).
- The coordinator presents the mockups to the user, who approves or requests revisions. **G0.** B8a–c cannot start before G0.

### B2 [S] Fonts and vector PDF adapter — lane W2 — depends: S3+S4, coordinator dependency add
**Read:** DL S3/S4 entries, Contracts `FontProfile`, PB B2.

**Files:** `fonts.ts::loadFontProfile(): Promise<FontProfile>` (the single profile), `vectorPdf.ts::svgToVectorPdf(svg: SanitizedSvg, page: PhysicalPage, fonts: FontProfile): Promise<Uint8Array>`, and tests with the S0 SVG fixture.

**Done when** these tests pass:
- `usesExactPageDimensions`: 157.8 × 227.1 mm gives a MediaBox of 447.31 × 643.75 pt ±0.05.
- `exportsAccentsAndReferencedGlyphs`: every `<use>` resolves, there is no image XObject, and the PDF text contains "eléison".
- `embedsOnlyTextFonts`: there is no music font object (Leipzig is drawn as paths).

**Escalate if:** any glyph is rasterised.

### B3a [H] TS contracts and settings — lane W1 — depends: S7 (or provisional presets)
**Read:** Contracts §1 and §1.1.

**Files:** `types.ts` (paste Contracts §1 verbatim), `settings.ts` (`normalizeSettings`, `paperDimensions`, `defaultMarginFor`, `verovioOptions`, `usableRect`) and `settings.test.ts`.

**Done when:**
- `paperDimensions({...DEFAULT_SETTINGS, page:'a5', orientation:'landscape'})` equals `{widthMm:210, heightMm:148, kind:'print'}`.
- A custom size of 500 × 100 is clamped with a notice. A ratio over 3 is clamped with a notice.
- A margin of 2 becomes 3, and 30 becomes 25.
- `defaultMarginFor` follows the rule in §1.1, including "user changed it, so keep it".
- The `export-paper` migration maps `'a4'` to a4 and `'letter'`, `null` or junk to letter.
- `verovioOptions` gives `scale:100` and `unit` 7/9/12.
- `pageWidth == floor(content.widthMm*10)`.
- WEB passes.

### B3b [O] ExportRun target/hash and selection extraction — coordinator — depends: B3a
**Files:**
- `web/src/lib/typeset.ts`: add `readonly target: string | null; readonly hash: string | null;` to `ExportRun` (lines 122–128) and fill them in `exportRuns()` from `seg.target` and `seg.render.hash`.
- New `web/src/lib/exportSelection.ts::readSelectionInput(root: ParentNode, showsScans: (key: string) => boolean): SelectionInput`, moved from ExportBar's inline `selection()` (around `ExportBar.astro:167–200`).
- `ExportBar.astro` updated to use it, with quick export unchanged.

**Done when:**
- `pnpm exec vitest run src/lib/typeset.test.ts src/lib/exportParts.test.ts src/components/ExportBar.test.ts` passes with only the new-field expectations added.
- The existing E2E `site.e2e.ts` export scenarios pass.

### B3c [S] Snapshot, capabilities, manifest lookup — lane W1 — depends: B3b, A6 fixture manifest
**Files:** `selection.ts::snapshotSelection(input, lookup): ExportPart[]`, `capabilities.ts::capabilitiesFor`, `web/src/lib/mei.ts` (`loadManifest(): ConversionManifest`, `approvedConversionFor(target, renderHash, manifest)`), and tests.

**Done when:**
- Mixed order gives `['mei','scan','fixed']`.
- A run where `showsScans` is true becomes `scan` with `customizableAvailable: true` even when a conversion exists.
- A partial typeset run stays scan.
- A stale `renderHash` gives no conversion.
- Duplicate references are rejected.
- `mei.ts` imports the production manifest unless `import.meta.env.PUBLIC_MEI_MANIFEST === 'fixture'` (see B10a).

### B4a [S] `paginate()` — lane W1 — depends: B3a
**Files:** `paginate.ts` with the signature in eng review §6 B4a (paste it) and `paginate.test.ts`, including property tests (fast-check if already present, otherwise a seeded loop of 500 random inputs).

**Done when, for all inputs:**
- No page exceeds the cap.
- Every forced start begins a page.
- Order is preserved.
- No page is empty.
- A system taller than the content gives `{ok:false, code:'SYSTEM_TOO_TALL'}`.
- The first page uses `firstPageContentHeightMm`.

### B4b [S] `resolveBreaks()` — lane W1 — depends: B3a
**Files:** `breaks.ts::resolveBreaks(part: MeiPart, settings, overrides): EffectiveBreaks` and tests.

**Done when:**
- Priority is user page > user system > policy (source breaks only when `original`) > automatic.
- A page break implies a system break.
- Stale `sourceRevision` gives `droppedOverrides` with `STALE_ANCHOR`.
- An unknown or unsafe boundary gives `UNSAFE_ANCHOR`.
- Anchors survive orientation and staff changes (same input, different settings, same user breaks).

### B4c [S] MEI break materialisation — lane W1 — depends: B4b
**Files:** `meiDoc.ts::materialiseBreaks(meiXml: string, breaks: EffectiveBreaks, boundaries: readonly SafeBoundary[], policy: LinePolicy): string` and tests. Parse and serialise with `@xmldom/xmldom` (`DOMParser`/`XMLSerializer` imported from it), **not** the global `DOMParser`. That global doesn't exist in Web Workers, where this runs, or in this repo's Vitest environment.

**Done when:**
- `<sb/>`/`<pb/>` are inserted after the boundary's `measureId`.
- Source `<sb>` is stripped when the policy is `automatic`.
- The input string is unchanged.
- The note `xml:id` set is identical before and after.

### B4d [S] Two-pass layout — lane W1 — depends: B4a, B4c, S2; coordinator adds `verovio` per S6
**Read:** DL S2 entry (the algorithm), Contracts `MeiLayout`/`LayoutConstraints`.

**Files:** `layout.ts` (`renderMei(part, settings, overrides, ctx): Promise<MeiLayout>`, `validateLayout`) and tests with a fake `VerovioLike`, plus one real-WASM Node test.

**Algorithm (per S2):**
1. Pass 1 renders one tall page (`pageHeight` 60000) with `breaks` set to `line` or `auto`, giving `SystemGeometry[]`.
2. `paginate()` assigns systems to pages.
3. Write `<pb>` at each page start and `<sb>` at each system start.
4. Pass 2 renders with `breaks:"encoded"`.
5. Verify that system-start boundary IDs equal pass 1's. A mismatch gives `UNSATISFIABLE_LAYOUT` with reason `no-convergence`; **no loop**.
6. Validate the cap, `EVENT_MISSING` and the staff height (±0.1 mm).
7. Fill `suggestions` per reason:
   - `system-too-tall`: `smaller-music`, `larger-page`, `portrait`/`landscape` as applicable;
   - `system-too-wide`: `fit-to-page`, `smaller-music`, `landscape`.

**Done when:**
- The fake-toolkit tests cover every branch.
- The real-WASM test on the experiment MEI at `letter-p-orig` and `ipad11-p-auto` passes: no cap violation, all event IDs present, staff 7.2 ± 0.1 mm.

**Escalate if:** pass 2 diverges from pass 1 on the experiment MEI.

### B4e [S] Layout matrix regression — lane W1 — depends: B4d
**Done when:** every Contracts §3 case renders the experiment MEI and the A3 output (when available) with no `CAP_EXCEEDED`, `CONTENT_CLIPPED` or `EVENT_MISSING`, and page frames are separate. No exact system-count assertions.

### B5 [S] SVG sanitization — lane W1 — depends: B4d
**Read:** PB B5 (all of it still applies).

**Files:** `svg.ts` (`sanitizePageSvg(svg, namespace): SanitizedSvg`, `measureSvgBounds`) and tests. Parse with `@xmldom/xmldom`, so it works in a worker and in Vitest. Construct its `DOMParser` with an `onError` that turns warnings and errors into `INVALID_PAGE`.

**Done when** the PB B5 assertions pass, plus:
- `INVALID_PAGE` for an unparseable document;
- sanitising the experiment SVG keeps every `<use>` reference resolvable;
- the geometry-preservation test passes.

Not Haiku. **Review focus:** allowlist completeness and bypasses.

### B6a [S] Canonical composition — lane W2 — depends: B4d, B5, B2
**Files:** `compose.ts::composeExport(parts, meiLayouts, settings, assets): Promise<LayoutResult>` and tests.

**Done when:**
- Each part starts a new page.
- Headings, rubrics and credits are measured with the `FontProfile` metrics.
- Scans pack whole images under the cap.
- Fixed pages use the source-paper rule (a4 when target h/w ≥ 1.35, else letter) with a uniform scale (`scaleX === scaleY`), centred.
- `unusedFraction` is computed.
- Digests are filled.
- `complete` is false whenever any part has an error diagnostic.

### B6b [S] Canonical PDF — lane W2 — depends: B6a; coordinator adds `@pdf-lib/fontkit`
**Files:** `exportPdf.ts::exportCanonicalPdf(result, assets): Promise<PdfResult>` and tests. The file is deliberately **not** named `pdf.ts`.

**Done when:**
- The page count equals `result.pages.length`.
- Each MediaBox equals the mm→pt value within 0.01 pt.
- Scans are embedded at original resolution.
- Fixed pages are embedded with `embedPdf` as vectors.
- MEI pages go through B2.
- Unicode headings use fontkit (never `pdfSafe`).
- `ASSET_MISSING` and `ASSET_HASH_MISMATCH` reject.
- `pnpm exec vitest run src/lib/pdf.test.ts` (quick export) is unchanged and passes.

### B6c [S] Fixed-page screen preview — lane W2 — depends: B6a; coordinator adds `pdfjs-dist`
**Done when:**
- `fixedPreview.ts` renders a fixed page to a bitmap only when a fixed part is present (a lazy dynamic import).
- The export path never imports it (a test on the import graph).

### B7a [H] Preferences — lane W3 — depends: B3a
**Files:** `preferences.ts` (`readPreferences(storage)`, `writePreferences(storage, prefs)`) and tests.

**Done when:**
- `readPreferences(null)` and a throwing storage give defaults plus a `STORAGE_BLOCKED` notice, with no throw.
- Corrupt JSON gives `PREFS_UNREADABLE`.
- An unknown version gives `UNKNOWN_VERSION_RESET`.
- `export-paper` is migrated and never written.
- Overrides keyed by target with an old `sourceRevision` are dropped with `STALE_ANCHOR`.

### B7b [S] Controller — lane W3 — depends: B7a, B4d, B6b (types only; fakes in tests)
**Files:** `controller.ts::createExportController(deps)` and tests with fake workers and timers.

**Done when** the PB B7 scenarios pass, plus:
- A stepper burst coalesces at 250 ms into one job.
- Token 1 arriving after token 2 is discarded.
- A setting change during exporting cancels the PDF.
- `resetLayout` keeps `page`, `customSize` and `orientation`.
- `undo` restores the previous overrides and settings, with a stack capped at 50.
- `canDownload` follows the Contracts definition exactly.
- A worker timeout terminates and recreates the worker.

### B7c [S] Workers — lane W3 — depends: B7b, S6
**Files:** `web/src/workers/export-layout.worker.ts` (lazy-loads Verovio and calls `renderMei`/`composeExport`) and `export-layout-pdf.worker.ts` (calls `exportCanonicalPdf`, transfers bytes).

**Done when:**
- A real-worker smoke test in Playwright renders the fixture manifest's Kyrie and returns a result.
- Cancellation drops stale tokens.

### B8a [S] Page preview component — lane W3 — depends: G0, B7c
**Read:** UI §1.6 and §5.

**Files:** `ExportPagePreview.astro` plus script, a container test (static markup only) and Playwright scenarios.

**Done when:**
- Page frames have the correct aspect ratio and `--print-paper`.
- "Page N of M" and the preset name sit outside the page.
- The blank-page note appears when `unusedFraction > 0.25`.
- Continuous view crops without changing `result.digests.result`.
- Zoom steps work.
- `role="img"` labels are correct.

### B8b [S] Editor dialog and controls — lane W3 — depends: B8a
**Read:** UI §1, §2, §3, §5, §6.

**Files:** `ExportLayoutEditor.astro`, `web/src/scripts/exportLayout.ts`, tests and Playwright scenarios at 1280, 768 and 390 widths.

**Done when:**
- Native `<dialog>` with `showModal()`, a history entry, and Back closing it.
- Focus moves to the title on open and returns to `#export-customize` on close.
- FIT is first: the Music size segmented control and the Systems stepper with "As many as fit (now N)" behaviour.
- Page tiers Print / iPad / Custom with the unit toggle and inline validation copy.
- The margins stepper uses per-kind defaults.
- Line breaks and More options (two controls).
- Every `LayoutDiagnosticCode` maps to UI §3 copy (a test iterates the union).
- No worker `detail` string ever reaches the DOM (a test).
- The single polite live region is throttled.
- Every target is ≥ 44 px (a Playwright bbox check).

**Escalate if:** the mockup and UI spec conflict; ask the coordinator.

### B8c [S] Break editing — lane W3 — depends: B8b
**Read:** UI §4.

**Done when:**
- Mode toggle; handles with 44 px hit areas, thinned when dense.
- Roving tabindex with ←/→/Home/End/Enter/Esc.
- A `role="group"` action panel with exact labels.
- Original line-break handling.
- Undo via button and Ctrl/Cmd+Z.
- Labels use `afterText`.
- Overlays are absent from canonical pages (check `result.pages[].svg` contains no overlay ids).

### B9 [O] Integration into ExportBar — coordinator — depends: B8c, B0, B3b
**Done when:**
- The `#export-customize` button follows UI §1.8 and renders only when an approved conversion exists (D5).
- It lazy-imports `exportLayout.ts`.
- `.primary`/`.link` are promoted to `base.css`, and `--print-paper`/`--print-ink` are added to `tokens.css`.
- A Playwright request log for `/` and one piece page shows no Verovio, PDF-adapter, pdfjs or font chunk requests until Customize is clicked. Record the baseline request list **before** the change.
- Quick export, source switching and `site.e2e.ts` are unchanged.
- WEB-BUILD passes.

### B10a [S] Acceptance harness — lane W3 — depends: B9
**Files:** `web/e2e/export-layout.e2e.ts` (full) and `web/scripts/verify-export-pdf.ts` (renders downloaded PDF pages via pdfjs, compares geometry and text with the canonical result, and includes a mutated-PDF negative test).

The fixture manifest is active only when `PUBLIC_MEI_MANIFEST=fixture`. `with-public-env.ts` refuses that value when `PUBLIC_ASSET_BASE` is the production base (the coordinator applies that one-line guard). The test build goes to `dist-e2e/`.

**Done when:**
- The Contracts §3 matrix passes on the fixture.
- The mutated PDF fails.
- A unit test proves the production build never resolves the `__fixtures__` manifest.

### B10b [U] Device check
The user, on a real iPad:
- opens the editor on Kyrie;
- downloads an 11-inch-preset PDF;
- imports it into forScore and confirms it fills the screen;
- checks staff legibility at the music desk;
- prints one Letter or A4 copy and measures the staff height (7.2 mm ± 0.2).

Record the results in DL. **This is part of G2.**

---

## 4. Publication and rollout — Plan C

### C1a [S] Verified publisher — lane PY — depends: A6
**Read:** PC C1, Contracts (`PublishInputs`, `VerifiedBundle`, `AssetStore`).

**Done when** the PC C1 tests pass, with a compiler spy count of 0, `KEY_COLLISION`, `HASH_MISMATCH` and `UNSAFE_PATH`.

Not Haiku. **Review focus:** whether any path lets the uploader execute source.

### C1b [S] Conversion workflow — coordinator merges YAML — depends: C1a
**Read:** `.github/workflows/typeset-preview.yml`, `corrections-batch.yml`, and `tests/test_typeset_workflows.py:12` (`test_preview_render_is_separated_from_secret_upload`), which is the pattern to copy.

**Done when:**
- `tests/test_mei_workflows.py` asserts that the compile job has `permissions: {}`, no `secrets.*` and the sandboxed runner.
- Upload is a separate job with no LilyPond.
- Forks cannot trigger upload.

### C2a [H] Budget admission — lane W3 — depends: B3a
**Done when:** `limits.ts::checkLayoutBudget` and `resource-profile.json` (`provisional: true`, `PROVISIONAL_LIMITS`) pass the PC C2 tests, including a test that the renderer-load spy is never called on rejection.

### C2b [S] Measurement harness — depends: B10a
**Done when:** `web/scripts/measure-export-layout.ts` records cold start, first preview, warm change, PDF time, chunk bytes and memory where available, over 5 runs per condition, and writes JSON under `build/`.

### C2c [U] Device runs
Run C2b on a desktop and a real iPad. The coordinator derives the measured profile (`provisional: false`). **G3.**

### C3 [O+U] Kyrie IX pilot release — depends: G0–G3, A5d
Follow PC C3 exactly, using the Kyrie target `movement:ordinarium-missae-ix/kyrie`. Rehearse the rollback (remove the manifest entry and rebuild) in staging. **G4** is the user's sign-off.

### C4a [S] Batch tooling — lane PY — depends: C3
**Done when** the PC C4 tests pass.

### C4b… [S] Conversion batches
These run per PC C4, using the conversion-batch prompt in P0 §2. Each batch has its own reviewer. Only the user approves.

---

## 5. DAG

```text
                 ┌─ S1[O] ── A2a ─ A2b ─ A2c ─ A2d ─ A2e
S0[H] ──┬─ A1a[H] ┴─ A1b ─ A1c                     │
        │                     S5[S] ─ A3a ─────────┼─ A3c ─ A3d ─ A3e ─ A4a ─ A4b ─ A4c ─ A5a ─ A5b ─ A5c ─ A5d[U] ─┐
        │                       S2[O] ─ A3b[O→H] ──┘                                         └─ A6 ─ C1a ─ C1b ─────┤
        ├─ B1[S] ─────────── G0[U] ─────────────────────────────────────────┐                                      │
S6[S] ──┼─ S2[O] ───────────────────────────┐                                │                                      │
        ├─ S3+S4[O] ─ B2 ─────────────┐      │                                │                                      │
S7[O] ── B3a[H] ─ B3b[O] ─ B3c        │      │                                │                                      │
         ├─ B4a ─ B4b ─ B4c ──────────┴──────┴─ B4d ─ B4e ─ B5 ─ B6a ─ B6b ─ B6c                                      │
         ├─ B7a[H] ───────────────────────────────── B7b ─ B7c ─ B8a ─ B8b ─ B8c ─ B9[O] ─ B10a ─ B10b[U] ─ C2b ─ C2c[U] ┤
         └─ C2a[H]                                                                                                    │
B0[H] ───────────────────────────────────────────────────────────────── B9                                   C3[O+U] ┘ ─ C4a ─ C4b…
```

**Parallel from day one:** S0, S6 and S7, then S1/S2/S3+S4/S5/B1/A1a/B3a. The Python lane and lanes W1, W2 and W3 then run concurrently, one card per lane at a time.

**Critical path:** S0 → S1 → A2a–d → A3c–e → A4a–c → A5a–d → C3. The web lanes use the experiment MEI and the A6 fixture manifest, so they are not on it.

**Escalation checkpoints (DL D10):** if S1 + A2 + A3 together pass 4 weeks, or S4 passes 2 weeks, the coordinator stops and reviews with the user.

## 6. Status board

| Card | Model | Lane | Status | Commit | Reviewer verdict |
|---|---|---|---|---|---|
| S0 | H | DOC/PY | ready | | |
| S1 | O | PY | blocked: S0 | | |
| S2 | O | W1 | blocked: S0, S6 | | |
| S3+S4 | O | W2 | blocked: S0, S6 | | |
| S5 | S | PY | blocked: S0 | | |
| S6 | S | W1 | ready | | |
| S7 | O | DOC | ready | | |
| B0 | H | W3 | ready | | |
| B1 | S | DOC | blocked: S0 | | |
| A1a | H | PY | blocked: S0 | | |
| B3a | H | W1 | ready (provisional presets) | | |
| _all others_ | per card | per card | blocked: dependencies | | |

**Tally:** 60 cards: [O] 8 (S1, S2, S3+S4, S7, A3b table, B3b, B9, C3), [S] 41, [H] 8 (S0, A1a, A1c, A2e, B0, B3a, B7a, C2a; plus A3b's transcription), [U] 3 cards (A5d, B10b, C2c). The user also signs gates G0 (B1), G1 (A5d), G2 (with B10b) and G4 (C3).
