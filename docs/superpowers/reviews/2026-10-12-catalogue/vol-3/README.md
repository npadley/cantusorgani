# vol-3 catalogue approval batch — 2026-10-12

The completed catalogue audit covers 859 non-empty sources: 777 approved (90.5%), 41 needing review, 25 failed and 16 unsupported. This volume has 238 sources with states `{"approved": 226, "failed": 8, "needs-review": 2, "unsupported": 2}`. 34 auto-approved sources lack a current manifest match and are deferred. This PR adds 192 generated profile-3 auto-approved records; existing current Missa IX approvals are retained.

Every added record passed fresh current-input and artifact verification against main `dd00a02`; all 192 matched the existing typeset target/render hash and passed the manifest builder without exclusions. The automatic review evidence covers all 13 production layouts. No sources, converter code, approval digests or live manifest entries were edited.

`summary.json` lists blocked sources, diagnostic families and failed approval criteria; counts overlap when a source has several findings. The following deterministic random sample is available for optional D22 spot-checking:

- `data/typeset/src/vol-3/an_adorna.csv.ly`
- `data/typeset/src/vol-3/co_christus_semel.csv.ly`
- `data/typeset/src/vol-3/of_benedicite_dominum.csv.ly`
- `data/typeset/src/vol-3/of_confessio.csv.ly`
- `data/typeset/src/vol-3/al_defecit_caro.csv.ly`

After this record PR merges, publish the numbered source lists in batches of at most 20 through main's `mei-conversion` workflow. Verify live hashes, immutable caching and CORS before a separate manifest PR. The P6 resource measurement gate must pass before large pieces go live; approval records alone do not enable reflow.
