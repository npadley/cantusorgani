# Reading edition: corrected intent and mockup

20 October 2026. Design exploration only. The previous click-through service mockup was rejected by the user and is superseded by this direction.

## Governing intent

The user clarified that the product is a place to **see Gregorian chant and organ accompaniment together, select the music required, and assemble it into one PDF**. Finding a date or service is an entry point to that experience. It must not become a replacement for the experience, or a sequence of separate part-selection screens.

The original design already establishes this:

- [Original NOH design](../claudekit/specs/2026-09-07-nova-organi-harmonia-design.md), Summary, Reading experience, and Chant pairing: a single assembled PDF of selected propers/settings, music readable in the browser, and a vertical reading order with chant beside its harmonization.
- [Proper parts and export plan](../claudekit/plans/2026-09-26-proper-parts-export-chant-links-plan.md), Goal and §6: parts navigable by jump links, selectable exports in liturgical order. A jump link is a convenience within the music, not a tab hiding the other parts.
- [Approved export editor UI](../superpowers/specs/2026-10-08-export-editor-ui-spec.md), §1.3 and §6: selection stays on the reading page; customization opens a dialog and closes back to the same reading position.
- [Chant-in-export design](../superpowers/specs/2026-10-19-chant-in-export-design.md), decided P1–P5, and [decision log](../superpowers/plans/export-layout-decisions.md), D25–D29: chant precedes each part; accompaniment continues below when space permits; the chant default follows the page preference; chant-only ships; chant goes through Customize export first; rubric characters remain red.

Historical implementation details in the September documents, including licensing assumptions and export defaults, must be read alongside newer decisions. The October export decisions remain authoritative. This mockup does not modify or implement those contracts.

## Revised visual direction

Open directly on a representative music page with:

1. A compact sacred-art masthead and editorial typography.
2. English service identification with the authentic Latin name immediately below it.
3. Optional jump links into a continuous reading page.
4. The complete chant above the complete organ accompaniment for each part, in order.
5. A checkbox at each part that changes export selection without removing its music from the reading page.
6. A selection summary and existing Quick/Customize export entry points.
7. A customization preview that preserves the selected parts and illustrates Off / Before each part / Chant only. Closing leaves the reader and their selection in place.

Use art in the masthead and restrained rubrics/rules around the music. Do not put art behind notation or make a large promotional hero the prerequisite to seeing it. Additional books should become inline alternative settings where useful; browsing source records remains secondary to reading and exporting the music.

## Mockup content and limitations

The study uses the catalogue's actual First Sunday of Advent Proper: all five parts, all 28 original accompaniment system images, and GregoBase chants 132, 1169, 1115, 962, and 1036. Chant is rendered by the repository's vendored Exsurge. Original part order and scans are preserved; English incipit glosses are editorial labels, not full chant translations. It is seeded with the chant display preference on to demonstrate the requested experience, not to change the production default.

The reading page is complete. The customization preview intentionally shows accompaniment excerpts and demonstrates composition/selection; it is not the production paginator and does not calculate or claim final page counts. Download controls explicitly identify this as a design study and do not generate a PDF. Existing export work by other agents remains untouched.

The Agnus Dei masthead is a newly generated visual concept, not historical source art. Built-in ImageGen was used with this prompt:

> Create an original reverent Romanesque woodcut of the Lamb of God with cruciform halo and cross-staff, framed by olive branches; dark warm umber and subdued rubric red on warm ivory; compact horizontal composition, no lettering or music notation, no shadows or gradients, solemn and legible at small masthead size.

The original generated PNG is retained. The preview packages a WebP encoding without altering the depicted artwork. Before any production adoption, the user should choose whether to retain this concept, commission original art, or use a verified historical source.

Visual study: `/Users/npadley/.codex/visualizations/2026/10/20/01a15795-8e32-7fa1-87c4-95e331ceef5a/cantus-organi-reading-edition.html`.

Art asset: `/Users/npadley/.codex/visualizations/2026/10/20/01a15795-8e32-7fa1-87c4-95e331ceef5a/assets/agnus-dei-masthead.webp`.

## Follow-up: centralized selection and complete export controls

The user identified two further shortcomings: requiring a hunt through the music to select parts, and omitting the existing MEI controls from the mockup. The omission was not authorization to remove functionality. No production code was changed. Future implementation must preserve existing capabilities unless the user explicitly approves a scoped change.

The revised study, `cantus-organi-selection-and-export.html`, adds a persistent export toolbar with **Choose parts**, opening one compact list of every part. It stays synchronized with inline checkboxes, offers Select all/Clear, and never removes music from the reading page. **Change parts** in the export dialog closes that dialog, opens the same selector, and returns with a fresh selection snapshot; the reader does not have to locate checkboxes along the page.

The export-control inventory is explicit: music size, maximum systems per page, print/iPad/custom page dimensions, orientation, margins, original/fitted line breaks, manual breaks, chant Off/Before/Only, sung-text size, system spacing, Pages/Continuous preview, zoom/Fit width, and Reset/Undo. The narrow layout places FIT above the preview with other settings in a panel.

The checked-in approved manifest identifies MEI for Advent I's Introit, Gradual, Alleluia, and Communion; no approved entry for its Offertory was found. The prototype demonstrates that mixed capability set, with an explicit **Use available customizable typeset** control. Choosing original scans hides controls that cannot operate on them while retaining page/margin/scan-packing controls. The reading and preview images remain original source references: the prototype does not run Verovio or claim that scaling a scanned system is MEI re-engraving. Control values and selection behavior are interactive; musical reflow, actual pagination, and PDF delivery remain the responsibility of the production engine.

Before implementing any redesign, compare its feature inventory against the existing UI specification and capability matrix, then verify the production regression suites. An absent mockup control must be flagged as unmodeled, never interpreted as an approved deletion.
