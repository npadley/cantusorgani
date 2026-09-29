---
name: project-plan-smells
description: Recurring architecture smells in this repo's claudekit plans (liturgical calendar keys, dual authorities, test gaps)
metadata:
  type: project
---

Recurring smells seen in plans under docs/claudekit/plans/ (first seen 2026-09-27, Vespers plan):

- Plans cite a Sunday by ordinal + date without checking data/calendar/<year>.json. The 2026-09-06 "14th Sunday after Pentecost" was actually `tempora:Pent15-0` (Missalemeum counts Trinity as `Pent01-0r`).
- Plans bring in a second calendar/rank authority (e.g. Divinum Officium's rank table) next to Missalemeum's data/calendar, without saying which one wins.
- Resumed Epiphany Sundays in November (`tempora:Epi5-0`/`Epi6-0`), Christ the King (`sancti:10-DU`) and multi-Mass keys (`sancti:12-25m1..m3`) are the calendar edge cases plans tend to miss.
- Plans say they "reuse exportSegments", but it is built around one piece's parts, with ids `${slug}:${start}`. Reusing the same systems twice (tone-bank reuse) would give duplicate ids.
- Test sections cover the pipeline steps well but skip web/src/lib/*.test.ts and the chant-matching steps.

**Why:** these come up again and again in reviews. **How to apply:** check the date-to-key mapping against data/calendar, and ask which source is the calendar authority, in every liturgy plan.

Added 2026-09-27 (editing/admin plan):
- Plans put logic in `noh catalog`, which opens pdf-source/ via pymupdf; CI has no PDFs, so anything that must run on merge has to be PDF-free.
- `vespers.check_lineup` fails when catalog.json's sha256 changes, so any catalog change forces a lineup rebuild.
- D1 `corrections.status` has a CHECK constraint (pending/accepted/rejected); new statuses need a table rebuild, not an "additive" migration. status.ts drops rows whose pieceId fails the slug regex.
- Production build refuses without PUBLIC_ASSET_BASE (with-public-env.ts); CI plans forget it.
