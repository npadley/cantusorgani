# Brief: P1 + P2 — `\prall` ornaments and the vol-1 tie mismatch

A self-contained task for a coding agent (Codex, Claude, or a person). Background: the site's **Customize export**
reflows LilyPond-typeset chant accompaniments in the browser. Each LilyPond source is converted to MEI by
`pipeline/typeset/mei/`, checked by an independent oracle and a render pre-check, and approved automatically
when every check passes (decision D22 in `docs/superpowers/plans/export-layout-decisions.md`). Read
`docs/superpowers/plans/2026-10-12-export-phase-2.md` first, then this brief.

## Why

588 of the 859 sources use `\prall`. The LilyPond listener never reports it, so the converter drops it silently;
since A8 such a score is held back from automatic approval with an `UNKNOWN_FEATURE` diagnostic. Converting
`\prall` is the single biggest coverage win.

## Start here

- Branch from `main` as `export/p1-prall`. Cherry-pick or merge the unfinished WIP commit `7fe46d5` on branch
  `export/a9` (listener and extractor changes only); review it rather than trusting it.
- Setup: `uv sync`, `uv run noh lilypond-install` (LilyPond 2.26), and `pnpm install` in `web/` (Verovio renders
  run through Node). Worktrees need the repo's `vendor/` (symlink it from the main checkout if missing).

## P1 — `\prall` → MEI (test-first)

1. **Listener** (`pipeline/typeset/mei/listen_full.ily`): report `\prall` articulation events with the note they
   attach to, in the TSV.
2. **Extractor** (`extract.py`): parse them into the IR (`model.py`), with the attached event id.
3. **Encoder** (`encode.py`): emit `<mordent form="upper" type="prall" startid="#…" staff="…" place="…"/>`.
   The quilisma already uses `<mordent form="upper">` (D16); keep the two distinguishable by `@type` everywhere.
4. **Oracle** (`normalize.py`, `validate.py`): compare ornaments by kind and attached note; a dropped or moved
   `\prall` must be a semantic difference. Add mutation cases (drop one, move one, turn one into a quilisma).
5. **Profile**: add the family to `data/typeset/mei/profiles/accompaniment-v1.json` and bump the profile version
   to 3. Once converted, `\prall` must no longer raise `UNKNOWN_FEATURE`; any other unconverted ornament still does.
6. **Pre-check** (`precheck.py`): a finding when an encoded ornament is not drawn.
7. **Look**: render three or four real pieces that use `\prall` and compare against LilyPond's own output for
   placement (above/below, which staff, which note). Fix anything that differs.
8. Other ornaments in the scan list (`\accent`, …): convert only where the mapping is clean; leave the rest as
   `UNKNOWN_FEATURE`.

## P2 — tie mismatch in five vol-1 pieces

`of_ad_te_domine`, `gr_dirigatur_oratio_mea`, `of_deus_enim`, `of_exsulta_satis`, `gr_salvos_fac_nos` fail the
oracle with `TIE_MISMATCH`: the IR and the encoder choose different tie targets. Find the cause, fix it, and add
each as a fixture.

## Rules

- Never hand-edit record digests. Do not write into `data/typeset/mei/records/` or `data/typeset/mei/manifest.json`;
  the coordinator re-judges and commits records afterwards.
- Converter changes make every approved record stale; that is expected (carry-forward/re-judging handles it).
- Python tests: `test_[function]_[scenario]_[expected]`. No `.skip`/`.only`. No `any` in TypeScript.
- Keep compiler concurrency at 2 on a laptop.

## Done when

- `uv run pytest -q -m "not slow"` and `uv run ruff check pipeline tools tests` pass; `cd web && pnpm test &&
  pnpm typecheck` pass.
- Missa IX still converts byte-identically, or the difference is explained (Missa IX uses no `\prall`).
- A sample run shows the effect:
  `uv run noh typeset-mei-batch --sources <30 vol-1 sources using \prall> --out build/p1-sample --workers 2 --auto-approve`,
  with counts by state before and after.
- A pull request against `main` with logical commits, the sample counts, and before/after images for two pieces.
