# O5 revocation drill: Ite, missa est (Missa IX)

Date: 2026-10-17. Local only: nothing was published, pushed to `main` or changed on the asset host. The live record
and manifest are byte-identical to `main` at the end of the drill (see Restore).

## What was added

- `uv run noh typeset-mei-revoke RECORD --reason TEXT` (`review.revoke` had no command). Tests: `tests/test_mei_revoke.py`.
- An automated drill on fixtures in the same file: revoke, the manifest and the stale report exclude the record,
  restore, and the record and manifest are byte-identical again.

## Steps and results

1. **Revoke.** `uv run noh typeset-mei-revoke data/typeset/mei/records/ite_IX.json --reason "O5 revocation drill, restored on the same branch"`.
   Only `ite_IX.json` changed (state `revoked`, a `revocation` block).
2. **`typeset-mei-stale`.** `none stale: 727 approved conversion(s) checked` (728 before). A revoked record is not listed as stale.
3. **`typeset-mei-manifest`.** The live artifacts of the five Missa IX records (Kyrie, Gloria, Sanctus, Agnus, Ite) were
   downloaded from `https://images.cantusorgani.org/mei/<sha>/{score.mei,boundaries.json}` into `<sha>/...` and the
   manifest built from those five records with normal artifact verification (no skip option exists or was used).
   - Before: 5 entries, each equal to the committed entry in `data/typeset/mei/manifest.json`.
   - After revoking: `excluded data/typeset/src/vol-5/missa-ix/ite_IX.ly: state is revoked`, 4 entries.
   - The other 723 committed entries cannot be rebuilt without their artifacts, so for the site build the committed
     manifest was used with the Ite entry removed (727 entries). That is the only difference from the committed file.
4. **The site.** Built locally with the CI variables (`PUBLIC_ASSET_BASE=https://images.cantusorgani.org
   PUBLIC_CORRECTIONS_ENDPOINT=https://api.cantusorgani.org PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm build`:
   exit 0, all 1,734 pages reachable), served statically, and driven with Playwright (Chromium) on `/kyriale/ix/`: Customize
   export, whole Mass, Letter portrait, with the real MEI and PDFs fetched from the asset host.
   - Kyrie, Gloria (3 pages), Sanctus and Agnus Dei: every page `data-kind="mei"` (reflowed by Verovio); their four MEI
     files were requested.
   - Ite, missa est: one page, `data-kind="fixed"`; its `letter.pdf` was requested and its MEI file was never requested.
     The editor says "Applies to: Kyrie, Gloria, Sanctus, Agnus Dei. Not to: Ite, missa est (fixed typeset layout)".
   - No page errors; "Download PDF · 7 pages".
   - Screenshot (viewed): `ite-fixed-placement.png` in this folder shows the Ite page as the fixed LilyPond typeset drawing
     placed on the page.
5. **Restore.** `git checkout` of `ite_IX.json` and `manifest.json`; `git diff -- data` is empty,
   `shasum -a 256 data/typeset/mei/records/ite_IX.json` equals that of `HEAD`, the five-record manifest rebuilt from the
   restored record is byte-identical to the first one, and `typeset-mei-stale` is back to 728 checked.

## Commit contents

This branch changes no record and no manifest.
