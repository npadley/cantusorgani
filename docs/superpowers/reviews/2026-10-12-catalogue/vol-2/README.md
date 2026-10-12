# vol-2 catalogue approval batch — 2026-10-12

The completed catalogue audit covers 859 non-empty sources: 777 approved (90.5%), 41 needing review, 25 failed and 16 unsupported. This volume has 221 sources with states `{"approved": 198, "failed": 9, "needs-review": 14}`. 10 auto-approved sources lack a current manifest match and are deferred. This PR adds 188 generated profile-3 auto-approved records; existing current Missa IX approvals are retained.

Every added record passed fresh current-input and artifact verification against main `dd00a02`; all 188 matched the existing typeset target/render hash and passed the manifest builder without exclusions. The automatic review evidence covers all 13 production layouts. No sources, converter code, approval digests or live manifest entries were edited.

`summary.json` lists blocked sources, diagnostic families and failed approval criteria; counts overlap when a source has several findings. The following deterministic random sample is available for optional D22 spot-checking:

- `data/typeset/src/vol-2/al_confitemini__et_invocate.csv.ly`
- `data/typeset/src/vol-2/co_aufer_a_me.csv.ly`
- `data/typeset/src/vol-2/of_intonuit_de_caelo.csv.ly`
- `data/typeset/src/vol-2/co_pascha_nostrum.csv.ly`
- `data/typeset/src/vol-2/al_pascha_nostrum.csv.ly`

After this record PR merges, publish the numbered source lists in batches of at most 20 through main's `mei-conversion` workflow. Verify live hashes, immutable caching and CORS before a separate manifest PR. The P6 resource measurement gate must pass before large pieces go live; approval records alone do not enable reflow.
