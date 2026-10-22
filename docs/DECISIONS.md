# Decisions log

Export decisions D1–D30 live in
[docs/superpowers/plans/export-layout-decisions.md](superpowers/plans/export-layout-decisions.md);
this file holds the rest. Don't re-propose a decision here. Raise it only if
new evidence changes the case, and say what the evidence is. Append new rows;
don't rewrite old ones. Where a design doc and this log disagree, this log and
the export decision log win ([index](design/README.md)).

## Decided

| ID | Date | Decision | Why | Source |
|---|---|---|---|---|
| P1 | 2026-09-26 | **GregoBase transcriptions are CC0.** Chant data carries no share-alike terms. Transcriptions GregoBase flags `copyrighted` are never published; the part links to GregoBase instead. | GregoBase's About page says all transcriptions are CC0. This replaces the CC-BY-SA assumption in the original design. | [data/LICENSES.md](../data/LICENSES.md), commit `c9a0f0b` |
| P2 | 2026-09-27 | **Corrections are an overlay.** Hand fixes go in `data/corrections.yml` and are applied over `catalog.base.json` by `noh apply-corrections`. Generated files are never hand-edited. Each correction records the value it replaced (`was`). | Pipeline rebuilds overwrite generated files; an overlay survives them and shows when a fix has become a no-op. | [editing/admin refactor plan](claudekit/plans/2026-09-27-editing-admin-refactor-plan.md), [AGENTS.md](../AGENTS.md) |
| P3 | 2026-10-03 | **The printed NOH scans govern corrections.** A transcription, a recognition result or a modern edition never overrides what the scan prints. | The scans are the source being catalogued. | [AGENTS.md](../AGENTS.md) "Never", [deferred MEI coverage plan](superpowers/plans/2026-10-12-deferred-mei-coverage.md) |
| P4 | 2026-10-03 | **Melody proofreading never auto-fixes.** The audit produces evidence for a person; no source, catalogue match or acknowledgment changes without review. | A chant melody is a musical judgment; a comparator only finds candidates. | [proofreading pilot design](superpowers/specs/2026-10-03-chant-proofreading-pilot-design.md), [AGENTS.md](../AGENTS.md) |
| P5 | 2026-10-06 | **LilyPond is the master; MEI is derived.** Volunteers edit LilyPond. A build converts it to MEI with evidence. Nobody hand-edits MEI. | One editable source, reproducible derivatives, an oracle to check the conversion. | [layout implementation plan](superpowers/plans/2026-10-06-export-layout-implementation-plan.md), [D1, D22](superpowers/plans/export-layout-decisions.md) |
| P6 | 2026-10-11 | **Ordinary Form scope.** Dates 2024–2050. Chant book is the Graduale Romanum (1974). Sundays and solemnities plus every explicitly named exception (Ash Wednesday, the Triduum, feasts of the Lord, Birth and Presentation of the BVM). Since 2026-10-19 also the seasonal weekday propers and the Christmas-octave feasts (St Stephen, St John, Holy Innocents). No other saints' feasts or memorials. Epiphany and Ascension have a transfer switch. | Keeps the calendar correct and testable; each exception has a citation and a test. | [OF calendar design](superpowers/specs/2026-10-11-ordinary-form-calendar-design.md), [seasonal weekdays](superpowers/plans/2026-10-19-of-seasonal-weekdays.md) |
| P7 | 2026-09-27 | **A date gets a Vespers page only if every item is placed by label or text**, not by order alone. An item placed by order is hidden and queued for review. | An order-only placement can put the wrong music in front of an organist. Removing a date is the rollback. | [Vespers full lineup plan](claudekit/plans/2026-09-27-vespers-full-lineup-plan.md) |
| P8 | 2026-10-20 | **Product intent.** The site is a place to see Gregorian chant and organ accompaniment together on one continuous reading page, select the music needed, and assemble it into one PDF. Finding a date is an entry point, not the product. Part selection stays on the reading page. | The user's correction of the 10-19 service-first mockup. | [reading-edition correction](reports/2026-10-20-reading-edition-design-correction.md) |
| P9 | 2026-10-20 | **A control missing from a mockup is not approval to delete it.** Every export control, the scan/typeset switch, polarity inversion, skip-to-music and clean printing must stay unless the user approves a scoped change. | Mockups omit things by accident. | [reading-edition correction](reports/2026-10-20-reading-edition-design-correction.md), [AGENTS.md](../AGENTS.md) |
| P10 | 2026-10-22 | **Agent concurrency.** Run at most 3–4 subagents at once. Reuse an agent (SendMessage) for follow-on cards. Opus coordinates; Sonnet or Haiku take bounded cards. | Past sessions overloaded the machine and the maintainer's review. | [CLAUDE.md](../CLAUDE.md), export decision [D10](superpowers/plans/export-layout-decisions.md) |
| P11 | 2026-10-22 | **The maintainer approves every upload, deploy and merge to `main`.** Images go to R2 through the `publish` workflow, not local credentials. | One owner for anything that reaches production. | [AGENTS.md](../AGENTS.md) "Ask the maintainer first" |
| P12 | 2026-10-22 | **Accessibility target: WCAG 2.2 AA across the site, with AAA (7:1) contrast for body text and music.** Applies to the public site, the admin screen and exported PDFs' on-screen preview; new UI is checked against it. | Organists read at the console, often on an iPad in poor light; the token file already aims for 7:1 text contrast. | Maintainer, 2026-10-22; criteria in [docs/ui/accessibility.md](ui/accessibility.md) |

## Proposed, not decided

From the 19 October reviews. Don't build from these without a decision.

| ID | Source | Proposal | Status |
|---|---|---|---|
| Q1 | [architecture review](reports/2026-10-19-architecture-build-and-design-review.md) | Keep Astro and the static public site; refactor selectively rather than replace the framework. | Proposed. No change made; matches current practice. |
| Q2 | [multiple sources and language](reports/2026-10-19-multiple-sources-and-language-direction.md) | Source-independent identities (opaque internal IDs, reviewed relationships) before importing a second book. | Proposed. The 10-20 report says they must serve the reading and export experience. |
| Q3 | same | English as the editorial language of the interface, Latin titles and incipits beside it, marked `lang="la"`; no duplicated `/en/` and `/la/` pages. | Proposed. |
| Q4 | architecture review | Readable recurring Vespers hub URLs; separate stable occasion content from date selection. | Proposed. Names illustrative, not an approved scheme. |
| Q5 | architecture review | A "printed Roman gradual" visual identity: masthead, a loaded serif, rubric headings. | Proposed. Compare concepts before implementing. |
| Q6 | multiple sources and language | The service-first click-through mockup (find a date, then pick parts). | Rejected 2026-10-20 (see P8). |
| Q7 | [platform options](reports/2026-10-23-platform-options.md) | Keep the public reader static while adding source-independent catalogue snapshots, private submission and native ingestion jobs, rights review and maintainer-approved publication; revisit database-backed rendering or a full app at measured thresholds. | Proposed. Promote Q1 and Q2 together only when the maintainer accepts this direction, with Q2 validated by a representative second-source pilot. |
