# Design documents: index and status

Where each spec, plan, review and report lives, and whether it is still true.
The two trees `docs/claudekit/` and `docs/superpowers/` stay where they are
(moving them would break links). This index replaces the need to open a file
to learn its status. Every spec and plan also carries a `Status:` line under
its title.

Related: [decisions log](../DECISIONS.md) · [glossary](../GLOSSARY.md) ·
[export decisions D1–D30](../superpowers/plans/export-layout-decisions.md) ·
[documentation audit](../reports/2026-10-22-documentation-audit.md) (§3 is the
source of these statuses).

## Status words

| Status | Meaning |
|---|---|
| SHIPPED | Built and on `main`. Read it for rationale, not for what to build. |
| PARTIAL | Some of it shipped; the file says what is open. |
| ACTIVE | Work in progress or the next thing to do. |
| ACTIVE REFERENCE | Governs current work. Read before you change that area. |
| PROPOSAL | Direction suggested, not decided. Do not build from it. |
| SUPERSEDED-BY | Replaced. The link says by what. Read the replacement. |
| REFERENCE | Evidence or background. True when written; may be out of date. |

## Start here: active documents

| Document | Why |
|---|---|
| [Export decision log (D1–D30, G0–G4)](../superpowers/plans/export-layout-decisions.md) | Every settled export decision. Do not re-propose a rejected option. |
| [Export contracts v2](../superpowers/plans/2026-10-08-export-contracts.md) | Frozen types and units for Customize export. |
| [Export editor UI spec](../superpowers/specs/2026-10-08-export-editor-ui-spec.md) | The screen, states, copy, and the list of controls that must stay. |
| [Export phase 2](../superpowers/plans/2026-10-12-export-phase-2.md) | What is left in Customize export (P6, O2, 131 deferred sources, spot checks). |
| [Chant in export: design](../superpowers/specs/2026-10-19-chant-in-export-design.md) and [cards](../superpowers/plans/2026-10-19-chant-in-export-cards.md) | Chant in the PDF. K9 user review is open. §4.2 is superseded by D30. |
| [Reading-edition design correction (10-20)](../reports/2026-10-20-reading-edition-design-correction.md) | Governing product intent. Added by PR #140. |
| [Documentation audit (10-22)](../reports/2026-10-22-documentation-audit.md) | State of the docs, bugs found, next steps. Added by PR #140. |
| [OF music coverage](../ORDINARY-FORM-MUSIC-COVERAGE.md) | Generated. Which Ordinary Form chants have NOH music. |
| [Device checklist (B10b)](../superpowers/plans/b10b-device-checklist.md) | The iPad and forScore check. |
| [Typesetting manual](../TYPESETTING.md) | Best doc for LilyPond, MEI and Verovio. |

## docs/claudekit/ (September 2026)

### specs/

| Path | Type | Status | Note |
|---|---|---|---|
| [specs/2026-09-07-nova-organi-harmonia-design.md](../claudekit/specs/2026-09-07-nova-organi-harmonia-design.md) | spec | SHIPPED | Original product design. Its CC-BY-SA licensing is wrong: GregoBase is CC0. Route list is stale. |
| [specs/2026-09-27-noh-retypesetting-research.md](../claudekit/specs/2026-09-27-noh-retypesetting-research.md) | research | SUPERSEDED-BY [typesetting design](../claudekit/specs/2026-09-28-typesetting-design.md) | Could the site show typeset music? |
| [specs/2026-09-28-typesetting-design.md](../claudekit/specs/2026-09-28-typesetting-design.md) | spec | SHIPPED (#31–#39) | Typeset music from the volunteers' LilyPond; browser review. |

### plans/

| Path | Type | Status | Note |
|---|---|---|---|
| [plans/2026-09-07-noh5-kyriale-pilot-plan.md](../claudekit/plans/2026-09-07-noh5-kyriale-pilot-plan.md) | plan | SHIPPED | NOH5 Kyriale pilot. |
| [plans/2026-09-26-proper-parts-export-chant-links-plan.md](../claudekit/plans/2026-09-26-proper-parts-export-chant-links-plan.md) | plan | SHIPPED | Proper parts, quick export, chant links. |
| [plans/2026-09-27-editing-admin-refactor-plan.md](../claudekit/plans/2026-09-27-editing-admin-refactor-plan.md) | plan | SHIPPED | Corrections overlay, EDITING guide, admin. |
| [plans/2026-09-27-vespers-full-lineup-plan.md](../claudekit/plans/2026-09-27-vespers-full-lineup-plan.md) | plan | PARTIAL | Releases 1–3 done. Compline not built. |
| [plans/2026-09-28-typesetting-plan.md](../claudekit/plans/2026-09-28-typesetting-plan.md) | plan | SHIPPED (#31–#39) | Implementation order for the typesetting design. |
| [plans/2026-09-29-proper-sections-plan.md](../claudekit/plans/2026-09-29-proper-sections-plan.md) | plan | SHIPPED | A Proper's sections as the book prints them. |

### reviews/ (all REFERENCE)

Autoplan reviews of four plans, in
[docs/claudekit/reviews/](../claudekit/reviews/): NOH5 Kyriale pilot, proper
parts export, editing/admin refactor, Vespers full lineup.

## docs/superpowers/ (October 2026)

### specs/

| Path | Type | Status | Note |
|---|---|---|---|
| [specs/2026-10-02-typesetting-review-completion-design.md](../superpowers/specs/2026-10-02-typesetting-review-completion-design.md) | spec | SHIPPED | Typeset source editing in admin; reader music-error reports. |
| [specs/2026-10-03-chant-proofreading-pilot-design.md](../superpowers/specs/2026-10-03-chant-proofreading-pilot-design.md) | spec | SHIPPED | Melody audit and 30-file pilot. Never auto-fixes. |
| [specs/2026-10-06-export-layout-editor-design.md](../superpowers/specs/2026-10-06-export-layout-editor-design.md) | spec | SHIPPED | Customize export. Decision log wins on conflict. |
| [specs/2026-10-08-export-editor-ui-spec.md](../superpowers/specs/2026-10-08-export-editor-ui-spec.md) | spec | ACTIVE REFERENCE | Authoritative UI. |
| [specs/2026-10-11-ordinary-form-calendar-design.md](../superpowers/specs/2026-10-11-ordinary-form-calendar-design.md) | spec | SHIPPED | OF calendar over the NOH substrate. |
| [specs/2026-10-19-chant-in-export-design.md](../superpowers/specs/2026-10-19-chant-in-export-design.md) | spec | SHIPPED (K9 open) | Chant in the PDF. §4.2 superseded by D30. |

### plans/

| Path | Type | Status | Note |
|---|---|---|---|
| [plans/2026-10-02-corrections-compatibility.md](../superpowers/plans/2026-10-02-corrections-compatibility.md) | plan | SHIPPED | Reader reports stay compatible with the catalogue. |
| [plans/2026-10-02-typesetting-review-completion.md](../superpowers/plans/2026-10-02-typesetting-review-completion.md) | plan | SHIPPED | Checkboxes inside are unticked; the work is done. |
| [plans/2026-10-03-chant-proofreading-pilot.md](../superpowers/plans/2026-10-03-chant-proofreading-pilot.md) | plan | SHIPPED | |
| [plans/2026-10-03-hymns-book-seven.md](../superpowers/plans/2026-10-03-hymns-book-seven.md) | plan | SHIPPED | Hymns index, NOH7 processing. |
| [plans/2026-10-06-export-layout-implementation-plan.md](../superpowers/plans/2026-10-06-export-layout-implementation-plan.md) | plan (Plan 0) | SUPERSEDED-BY [execution packet](../superpowers/plans/2026-10-08-export-execution-packet.md) | Rationale only. |
| [plans/2026-10-06-mei-conversion-plan.md](../superpowers/plans/2026-10-06-mei-conversion-plan.md) | plan (Plan A) | SUPERSEDED-BY [execution packet](../superpowers/plans/2026-10-08-export-execution-packet.md) | Rationale only. |
| [plans/2026-10-06-export-editor-plan.md](../superpowers/plans/2026-10-06-export-editor-plan.md) | plan (Plan B) | SUPERSEDED-BY [execution packet](../superpowers/plans/2026-10-08-export-execution-packet.md) | Rationale only. |
| [plans/2026-10-06-export-rollout-plan.md](../superpowers/plans/2026-10-06-export-rollout-plan.md) | plan (Plan C) | SUPERSEDED-BY [execution packet](../superpowers/plans/2026-10-08-export-execution-packet.md) | Rationale only. |
| [plans/2026-10-08-export-contracts.md](../superpowers/plans/2026-10-08-export-contracts.md) | contract | ACTIVE REFERENCE | Frozen types, v2. |
| [plans/2026-10-08-export-execution-packet.md](../superpowers/plans/2026-10-08-export-execution-packet.md) | task cards | SHIPPED | §6 board superseded by phase 2; "only the user approves" by D22. |
| [plans/2026-10-11-ordinary-form-calendar-implementation-plan.md](../superpowers/plans/2026-10-11-ordinary-form-calendar-implementation-plan.md) | plan | SHIPPED | |
| [plans/2026-10-12-deferred-mei-coverage.md](../superpowers/plans/2026-10-12-deferred-mei-coverage.md) | plan | SHIPPED | |
| [plans/2026-10-12-export-phase-2.md](../superpowers/plans/2026-10-12-export-phase-2.md) | plan | PARTIAL | What is left of Customize export. |
| [plans/2026-10-12-p1-prall-brief.md](../superpowers/plans/2026-10-12-p1-prall-brief.md) | brief | SHIPPED | `\prall` ornaments and a vol-1 tie. |
| [plans/2026-10-19-chant-in-export-cards.md](../superpowers/plans/2026-10-19-chant-in-export-cards.md) | task cards | SHIPPED (K9 open) | |
| [plans/2026-10-19-of-seasonal-weekdays.md](../superpowers/plans/2026-10-19-of-seasonal-weekdays.md) | plan | SHIPPED | GR1974 seasonal weekdays (#136). |
| [plans/b10b-device-checklist.md](../superpowers/plans/b10b-device-checklist.md) | checklist | ACTIVE REFERENCE | iPad and forScore. |
| [plans/export-layout-audit-2026-10.md](../superpowers/plans/export-layout-audit-2026-10.md) | audit | REFERENCE | Catalogue signal counts, 2026-10-09. |
| [plans/export-layout-decisions.md](../superpowers/plans/export-layout-decisions.md) | decision log | ACTIVE REFERENCE | D1–D30, G0–G4, R-entries. Canonical. |

### reviews/, experiments/, mockups/ (all REFERENCE)

| Path | What it holds |
|---|---|
| [reviews/2026-10-08-export-ceo-review.md](../superpowers/reviews/2026-10-08-export-ceo-review.md), [design](../superpowers/reviews/2026-10-08-export-design-review.md), [eng](../superpowers/reviews/2026-10-08-export-eng-review.md) | Reviews of the export design. |
| [reviews/2026-10-11-ordinary-form-*](../superpowers/reviews/) | OF calendar plan, implementation and source reviews. |
| [reviews/2026-10-12-*, 2026-10-15-*, 2026-10-17-*](../superpowers/reviews/) | Catalogue, lyrics, deferred MEI, export operations, P5, P1/P2, publication evidence; the O5 revocation drill. |
| [experiments/](../superpowers/experiments/) | Spikes S1–S7 (extraction, Verovio, fonts and PDF, schema, bundling, iPad presets), Kyrie IX, chant export. |
| [mockups/export-layout/](../superpowers/mockups/export-layout/) | Export editor mockups (gate G0). |

## docs/reports/ (untracked on some branches; PR #140 adds the first three)

| Path | Type | Status | Note |
|---|---|---|---|
| [2026-10-20-reading-edition-design-correction.md](../reports/2026-10-20-reading-edition-design-correction.md) | report | ACTIVE | Governing product intent; supersedes the 10-19 framing. |
| [2026-10-19-multiple-sources-and-language-direction.md](../reports/2026-10-19-multiple-sources-and-language-direction.md) | report | PROPOSAL | Its service-first mockup was rejected. Source-independent identities and English UI remain proposals. |
| [2026-10-19-architecture-build-and-design-review.md](../reports/2026-10-19-architecture-build-and-design-review.md) | report | PROPOSAL | Product framing superseded by 10-20. Build and code findings stand. |
| [2026-10-22-documentation-audit.md](../reports/2026-10-22-documentation-audit.md) | report | ACTIVE | Read-only audit. |
| [2026-10-03-book-seven-*](../reports/2026-10-03-book-seven-hymn-references.md) (references, routes, assets) | research | REFERENCE | Hymns Book VII evidence. |
| [2026-10-03-hymn-gregobase-*](../reports/2026-10-03-hymn-gregobase-pairings.md) | research | REFERENCE | Hymn to GregoBase pairings. |
| [2026-10-04-alleluia-verse-*](../reports/2026-10-04-alleluia-verse-pairings.md) | research | REFERENCE | Alleluia verse pairings. |

## Top-level reports and manuals in docs/

| Path | Type | Status | Note |
|---|---|---|---|
| [ADMIN-UX-REVIEW.md](../ADMIN-UX-REVIEW.md) | review | SHIPPED | Admin changes shipped (#77, #80, #81). 15 screenshots never committed. |
| [REFERENCE-AUDIT.md](../REFERENCE-AUDIT.md) | audit | REFERENCE | |
| [CHANT-PROOFREADING-PILOT.md](../CHANT-PROOFREADING-PILOT.md) | report | REFERENCE | Output of the proofreading pilot. |
| [ORDINARY-FORM-MUSIC-COVERAGE.md](../ORDINARY-FORM-MUSIC-COVERAGE.md) | generated | ACTIVE REFERENCE | Do not hand-edit. |
| [TYPESETTING.md](../TYPESETTING.md) | manual | ACTIVE REFERENCE | Links the two 09-28 typesetting docs above. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | manual | PARTIAL | Out of date; see AGENTS.md "Known gaps". |
| [OPERATIONS.md](../OPERATIONS.md), [EDITING.md](../EDITING.md), [ADMIN-SETUP.md](../ADMIN-SETUP.md), [SEO.md](../SEO.md) | manuals | ACTIVE REFERENCE | |
