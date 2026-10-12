# vol-5 catalogue approval batch — 2026-10-12

The completed catalogue audit covers 859 non-empty sources: 777 approved (90.5%), 41 needing review, 25 failed and 16 unsupported. This volume has 138 sources with states `{"approved": 109, "failed": 5, "needs-review": 10, "unsupported": 14}`. 15 auto-approved sources lack a current manifest match and are deferred. This PR adds 89 generated profile-3 auto-approved records; existing current Missa IX approvals are retained.

Every added record passed fresh current-input and artifact verification against main `dd00a02`; all 89 matched the existing typeset target/render hash and passed the manifest builder without exclusions. The automatic review evidence covers all 13 production layouts. No sources, converter code, approval digests or live manifest entries were edited.

`summary.json` lists blocked sources, diagnostic families and failed approval criteria; counts overlap when a source has several findings. The following deterministic random sample is available for optional D22 spot-checking:

- `data/typeset/src/vol-5/missa-x/kyrie_X.ly`
- `data/typeset/src/vol-5/missa-iv/agnus_IV.ly`
- `data/typeset/src/vol-5/missa-ii/ite_IIa.ly`
- `data/typeset/src/vol-5/ad-libitum/sanctus_ad_libitum_I.ly`
- `data/typeset/src/vol-5/missa-iii/sanctus_III.ly`

After this record PR merges, publish the numbered source lists in batches of at most 20 through main's `mei-conversion` workflow. Verify live hashes, immutable caching and CORS before a separate manifest PR. The P6 resource measurement gate must pass before large pieces go live; approval records alone do not enable reflow.
