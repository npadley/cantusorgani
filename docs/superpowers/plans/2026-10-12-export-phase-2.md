# Custom export — phase 2 plan

Written 2026-10-12, at the hand-off from phase 1 (the Kyrie IX pilot, then Customize export on every page and
automatic approval). This document replaces the status board in `2026-10-08-export-execution-packet.md` §6
as the list of what is left. Decisions and gates stay in `export-layout-decisions.md` (D1–D24, G0–G4).

## Where things stand (refreshed 2026-10-17)

| What | State |
|---|---|
| Customize export | **Live on every page** with an export bar (#104, D23). |
| Reflow coverage | **728 of 859** non-empty sources live (85 %): Missa IX (#106), volumes 1, 2, 3 and 5 (#117–#120), and 20 recovered deferred scores (#122, #127). The manifest has 728 entries and zero exclusions. |
| Converter | `\prall` and the vol-1 tie targets fixed (#108); layout residuals and split-tie marks fixed (#121). |
| Remaining | **131 deferred sources**, listed per source in [final-coverage.md](../reviews/2026-10-12-deferred-mei-coverage/final-coverage.md); summarised under "Deferred sources" below. |
| iPad timing page (C2c) | Parked on branch `export/c2c-prep`; G3 passed without it. |

## R. Finish the release (coordinator; user merges) — done 2026-10-12, see DL R4

- [x] **R1** — Merge #104 when CI is green. Customize export goes live on every page; reflow stays Kyrie-only
  until R3.
- [x] **R2** — Run `mei-conversion` on `main` with `publish: true` and the five Missa IX sources
  (`data/typeset/src/vol-5/missa-ix/{kyrie,gloria,sanctus,agnus,ite}_IX.ly`). Then check each
  `https://images.cantusorgani.org/mei/<sha>/{score.mei,boundaries.json}`: 200, `immutable`, CORS `*`,
  and the sha256 matches its record. If CI's conversion is not byte-identical to the record, the publish job
  refuses — find the difference before retrying.
- [x] **R3** — Manifest PR: `uv run noh typeset-mei-manifest --records data/typeset/mei/records --out
  data/typeset/mei/manifest.json --artifacts <dir of the live files>` (lay the downloaded files out as
  `<sha>/{score.mei,boundaries.json}`). Build production locally with the CI env, run the full Playwright suite,
  open Missa IX → Customize export → whole Mass, then merge.
- [x] **R4** — Live smoke test: Missa IX whole-Mass custom export reflows all five parts; another Mass shows the
  button with fixed/scan placement; a scan-only piece works; quick export is unchanged. Record the release in DL
  (commit, published shas, rollback = revert the manifest PR).

## P. Raise reflow coverage (agents)

Order matters: P1 and P2 change the converter, so run the catalogue (P4) after them.

- [x] **P1 `\prall` and other ornaments → MEI** — [S], encoder. Start from `export/a9` (`7fe46d5`).
  588 of 859 sources use `\prall`; a score with an unconverted ornament is never auto-approved
  (UNKNOWN_FEATURE), so this is the single biggest coverage win.
  - Listener acknowledger → IR field → encoder `<mordent form="upper" type="prall">` → oracle comparison and
    mutation → precheck "ornament drawn" → profile v3.
  - Keep it distinct from the quilisma (D16 also uses `<mordent form="upper">`): `@type` in the MEI and in the
    oracle.
  - Then the rest of the ornament scan list (`\accent` etc.) where they map cleanly; otherwise they stay
    UNKNOWN_FEATURE.
  - View a few real pieces against LilyPond (above/below, which staff).
- [x] **P2 TIE_MISMATCH in five vol-1 pieces** — [S], encoder. `of_ad_te_domine`, `gr_dirigatur_oratio_mea`,
  `of_deus_enim`, `of_exsulta_satis`, `gr_salvos_fac_nos`: the IR and the encoder pick different tie targets.
  Fix with fixtures.
  P1 + P2 implemented 2026-10-12; [verification and sample evidence](../reviews/2026-10-12-p1-p2/README.md).
  Other/ambiguous ornaments stay UNKNOWN_FEATURE; four malformed P2 sources retain review warnings.
- [x] **P3 Source errors → corrections workflow** — coordinator. `vol-1/al_excita_domine.csv.ly`
  (non-positive duration) and `vol-1/in_rorate__ps_caeli_enarrant.csv.ly` (slur never stops; LilyPond also
  ignores a doubled slur start elsewhere). These are transcription errors, not converter bugs: file them as
  corrections rather than working around them.
- [x] **P4 Catalogue run and batch publication** — [S] run, coordinator publishes.
  - `uv run noh typeset-mei-batch --sources <all non-empty sources> --out build/catalogue --workers 2
    --auto-approve` (resumable; about 1.5–3 pieces a minute on a loaded machine — run it overnight).
  - Commit approved records in reviewable batches (by volume), publish each batch through `mei-conversion`
    (check how many sources one dispatch can take; split if needed), then a manifest PR per batch.
  - Each batch report lists a small random sample of auto-approved pieces for an optional spot-check (D22).
  - Report coverage from the audited denominator, and blockers by family.
- [x] **P5 Layout residuals** — [S], layout.
  - Avoidable mid-word starts that remain (B4d8: 8 starts in 5 pieces, fixtures in
    `web/src/lib/export-layout/__fixtures__/catalogue/`). D24 already lets an unavoidable one through as `info`.
  - Precheck tie-endpoint tolerance: a revealed eighth-note continuation with a flag starts its tie ~0.3 mm
    further right than the precheck expects (`co-video-caelos`, `in-exsurge`, `letter-p-large-auto`). The tie is
    drawn correctly; widen the tolerance for flagged heads with a test.
  - Lyric collisions from Verovio's own spacing (`al-crastina-die`, `al-spiritus-ejus`, `in-exsurge`) are not
    counted by the precheck. **Decision for the user:** should a lyric collision block automatic approval?
  - Tiny split-tie stubs at the far right of a system (the first piece of a tie whose end is revealed on the
    next system; e.g. Gloria iPad mini system 3) read as stray marks. Consider a minimum visible length or
    drawing them as a proper end-of-system tie.
- [ ] **P6 Measured resource profile** — coordinator, before large pieces go live. `resource-profile.json` is
  still `provisional: true`. Re-run `web/scripts/measure-export-layout.ts` on a quiet machine with the largest
  approved pieces and set real limits (the parked C2c page can give iPad numbers if wanted).

### What each P card costs

| Card | Agent (usage) | Laptop (processing) |
|---|---|---|
| P1 `\prall` | **Yes** — one encoder-agent run, about the size of the A5g card: write the LilyPond listener hook, IR, encoder and oracle changes with tests, and view a few pieces against LilyPond. | Light: tests and a handful of conversions. |
| P2 ties | Yes — a smaller encoder-agent run (one bug, five fixtures). Can share P1's run. | Light. |
| P3 source errors | Minimal — the coordinator files two corrections. | None. |
| P4 catalogue | Minimal — the coordinator starts one command, then reads its report and commits records. | **Heavy**: LilyPond plus 13 Verovio renders per piece for ~860 pieces; several hours (run overnight, plugged in). |
| P5 layout | Yes — one layout-agent run. | Light. |
| P6 limits | Minimal. | Moderate: one measurement run on a quiet machine. |

The cheapest order on a tight week: P1 + P2 in one agent run, then P4 overnight (almost no usage), then decide on P5
from P4's report.

## Deferred sources (131)

Fresh judgments (2026-10-15): 797 approved, 42 needs-review, 18 failed, 2 unsupported. Of the 131 not live:

| Blocker | Sources | Owner |
|---|---:|---|
| Converts and passes, but has no site target (catalogue/mapping gaps, e.g. S. Annae Introit NOH3 p.281, Ego dixi Gradual NOH2 p.112) | 67 | **User** — editorial target decisions |
| Source ties/slurs to check against the printed scan | 34 | User/editor → corrections |
| Source does not compile (transcription syntax; Oravi has an unresolved token) | 15 | Corrections against the scan |
| Layout: compact ties (four Haec dies), clipping | 6 | Engineering |
| Converter edge cases: zero-duration notes, tuplet schema, divisio or break inside a measure, unclosed slur | 9 | Engineering, partly source fixes |

The cheapest next step is an editorial review list of the 67 unmapped sources, grouped by volume. Nothing here
blocks the 728 live pieces.

## O. Operations and follow-ups

- [x] **O1 First real run of `mei-stale.yml`** — it has only structure tests. Watch its first run after a
  source/include/converter change on `main`; check the prior-revision rebuild and the carry-forward artifact.
- [ ] **O2 Admin "Custom export paused" list** — confirm it shows real stale pieces after O1 (the site build
  writes `build/mei/stale/stale.json`).
- [x] **O3 Dependabot** — 15 alerts on `main` (10 high) that predate this work. 0 open as of 2026-10-17.
- [x] **O4 Docs** — bring `docs/TYPESETTING.md` up to date with the batch, carry, stale and auto-approval
  commands and the release steps in R.
- [x] **O5 Revocation drill** — revoke one auto-approved record (state `revoked`), rebuild the manifest, check
  the button reverts to fixed placement for that piece, then restore it. Done 2026-10-17 with the new
  `typeset-mei-revoke`; see `docs/superpowers/reviews/2026-10-17-o5-revocation-drill/`.

## Decisions needed from the user

1. Resolved: gaps below 0.3 mm are nonblocking review warnings (user, 2026-10-12). (P5)
2. Spot-check cadence for auto-approved batches: optional sample as now, or a required sample per volume? (P4)
3. Resolved: P1–P5 were run by Codex (2026-10-12 to 2026-10-15).

## Working notes for whoever picks this up

- **Branches.** `export/next` is the integration branch until #104 merges; after that, branch from `main`.
  Parked work: `export/a9`, `export/c2c-prep`. Spike branches are archived as tags `archive/export-s34`,
  `archive/export-s6`, `archive/export-status-board`.
- **Agents.** At most 3–4 at once; reuse an agent for follow-on cards. Sonnet for encoder and layout cards,
  Haiku for small bounded ones. Give each its own branch; two writers never touch the same files. The encoder
  owns `pipeline/typeset/mei/{extract,encode,model,normalize,validate}.py` and `listen_full.ily`; layout owns
  `web/src/lib/export-layout/` (with `meiDoc.ts` shared by agreement); review and approval code
  (`review.py`, `manifest.py`, `versions.py`, `stale.py`, `carry.py`) changes need the coordinator.
- **Local builds.** The shell is zsh: pass build variables inline
  (`PUBLIC_ASSET_BASE=https://images.cantusorgani.org PUBLIC_CORRECTIONS_ENDPOINT=https://api.cantusorgani.org
  PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm build`), not through `env $VAR`, or the corrections
  tests fail for environmental reasons.
- **Tests that count analytics** must route `**/gc.zgo.at/**` to an empty script before stubbing
  `window.goatcounter`, or CI's real script replaces the stub.
- **Records.** Never hand-edit digests. Re-judge with `typeset-mei-batch --auto-approve` into `build/`, copy the
  approved records into `data/typeset/mei/records/`, and confirm `typeset-mei-stale` reports none stale. Any
  converter change makes every record stale: carry-forward (`typeset-mei-carry`) keeps those whose MEI and 13
  renders are unchanged; the rest are re-judged.
- **Device testing.** `pnpm build:e2e && pnpm serve:device` serves the fixture build to an iPad on the LAN
  (see `b10b-device-checklist.md`).

Operations started 2026-10-12 after #108: [carry restoration and catalogue notes](../reviews/2026-10-12-export-operations/README.md). P4 completed: 708 eligible records published, all 1,416 live objects verified, volume manifest PRs #117–120 merged, deployment and live reflow/lyric-placement checks passed. Of 859 audited sources, 69 approved sources await target matching and 82 remain technically or editorially blocked. [P5 evidence and deferred inventory](../reviews/2026-10-12-export-p5/README.md).

2026-10-12 release decision: user authorized upload and merge using the existing export limits; additional P6 measurement is deferred. Site release PRs may be merged by the coordinator after green CI and verification.

2026-10-12 P5: generated split ties now attach to the nearest visible predecessor; lyric spacing is reported as nonblocking advice. Existing word-boundary fixtures and flagged-note endpoint checks pass, so no speculative tolerance relaxation was added. The seven additional deferred layout cases still reproduce and remain deferred; completing this card does not approve or publish them.
