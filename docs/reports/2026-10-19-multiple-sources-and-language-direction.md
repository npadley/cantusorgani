# Multiple sources, language, and the next site structure

**20 October correction:** the click-through service mockup below was rejected. The governing experience is a continuous music page showing chant and accompaniment together, with inline selections feeding one PDF. See [the corrected intent and reading-edition study](2026-10-20-reading-edition-design-correction.md). Source-independent identities remain a proposal; they must support this reading/export experience.

19 October 2026. Supplement to the architecture/build review; proposed direction, not an approved implementation specification.

## Confirmed intent

The primary journey is finding music for a date or service. The collection may expand to all three of: other organ-accompaniment books, hymn books with tunes/harmonizations, and unaccompanied chant editions or resources. The user also wants a more solemn visual identity and clearer English alongside Latin.

## Reconsider the content model now; grow the infrastructure when needed

Introduce source-independent identities during the planned refactor, before importing the next collection. Keep the existing static site and NOH pipeline working. A second source should validate the model through a small representative import; do not migrate every historical record before testing it.

Current `Piece` records combine source-book structure, calendar assignments, musical content, page/system locations, and rendering information (`web/src/lib/catalog.ts:109`). Most of that is valuable, but it cannot be the universal identity of a chant. `sourceLabel` explicitly produces NOH labels (`:448`), and hymn associations have NOH7-specific behavior (`:736`). New books should not inherit those assumptions.

Use a modest set of distinct concepts:

| Concept | Purpose | Example |
| --- | --- | --- |
| Occasion / service assignment | What belongs in a particular liturgy, calendar, date, cycle, and slot | First Sunday of Advent, Mass, Introit |
| Text / chant identity | The identifiable text or chant, with explicit variants | Ad te levavi; an identified chant tradition or melody |
| Musical setting | A particular tune, melody version, arrangement, or harmonization | A named organ accompaniment; an unaccompanied version |
| Source edition and item | Where a setting is printed and how it is identified there | Collection, volume, editor, date, folio/page, item number |
| Digital representation | How that source/setting can be read, played, or exported | Scan, approved typesetting, MEI, GABC, PDF, or external link |

These relationships are not all one-to-one. The same setting can appear in several editions; a source item can contain several movements or chants; a hymn text can use multiple tunes, and a tune can carry several texts. A typeset transcription of one accompaniment is a representation of that setting, not necessarily a new setting. A resource can be indexed without having redistributable music attached.

Do not equate matching incipits with identical chants, or matching hymn texts with identical tunes. Use opaque internal IDs and reviewed relationships; keep GregoBase and other catalogue IDs as external references rather than making one external service the only identity authority. Preserve uncertain matches as uncertain. Store source citation, transcription/review status, publication permissions, and available capabilities explicitly; provenance belongs to each item/representation, not a site-wide assumption.

Keep liturgical assignments separate from where the music happened to be printed. Reuse the existing calendar distinctions and reviewed mappings. A source's own heading can describe historical usage without automatically becoming the site's current assignment.

## Progressive transition

1. Add a collection/edition registry and source-neutral display labels. Preserve current IDs, correction targets, asset paths, and inbound URLs.
2. Adapt existing NOH records into a shared read model while keeping the NOH-specific import/review pipeline intact.
3. Import a small sample spanning all three new source types: a second accompaniment for the same chant, a hymn text with two tunes or harmonizations, and an unaccompanied chant. Verify citations, alternate choices, search, and export eligibility.
4. Add per-source import adapters and independent content hashes. A hymn-book correction must not rerun unrelated NOH scan analysis or typesetting. Produce small indexes by occasion, work, setting, and source; keep heavy files behind the relevant interaction.
5. Expand only after the sample exposes and resolves real model gaps. Extend admin editing gradually; avoid one enormous editor for every source format.

Reconsider databases or a CMS when concurrent editors, editorial workflow, correction volume, or cross-collection queries outgrow versioned files and generated indexes. Reconsider on-demand rendering when measured build/output costs warrant it. The number of books alone does not establish either need.

## Information architecture and URL direction

Keep the service finder first. A date resolves to its calendar occasion and service slots; each slot offers eligible settings, with instrument, edition, and review status clearly distinguished. Default to a reviewed, usable setting while allowing alternatives. Do not silently substitute a different melody or accompaniment because it is in another source.

Support three secondary ways in: Sundays/feasts, chants/hymns, and books/sources. A chant page explains the content and lists settings; a source page preserves the edition's printed order and citation. Existing piece pages can remain source records. Add a setting/work identity only where it has a distinct useful purpose, rather than generating several thin pages for every relationship.

Illustrative new paths: `/chants/ad-te-levavi/`, `/hymns/<text-or-work>/`, `/sources/<edition>/`, and an edition-scoped item path. Slugs need stable disambiguation for homonymous chants, tunes, and editions. These examples are not a final migration scheme. Preserve existing recurring Mass and dated service URLs first, then map any necessary moves explicitly.

The Cantus Organi name can continue to anchor a service-focused library that includes unaccompanied resources, with an expanded English descriptor. Revisit naming if the audience becomes primarily a general chant archive; no immediate rebrand is required to support the model.

## English and Latin

Latin is an important discovery term and part of the source identity. This audit has no Search Console evidence that it is harming rankings. Adding visible English is a usability and relevance recommendation, not a guaranteed ranking improvement.

Use English as the editorial language of the current interface: navigation, service names, concise descriptions, and explanatory copy. Retain authentic Latin titles and incipits beside it, and mark those spans `lang="la"` for assistive technology. Existing recurring day pages already use English titles and Latin subtitles; extend that pattern consistently rather than treating the whole site as Latin-only.

Examples:

- Service heading: **First Sunday of Advent**, followed by *Dominica prima Adventus*.
- Chant heading: **Ad te levavi**, followed by **To you I lift up my soul** and a short English identification such as “Introit for the First Sunday of Advent.”
- Candidate page title: **First Sunday of Advent: Chant & Organ Music | Cantus Organi**.
- Candidate chant title: **Ad te levavi — Advent Introit & Settings | Cantus Organi**.

Store original titles, English display titles, original incipits, English glosses, aliases, and full text translations as distinct fields. Search the visible English and Latin, using accent/punctuation normalization while preserving the authentic display spelling. Clearly distinguish a brief editorial gloss from a complete translation; retain attribution/source/review metadata for translations.

Do not create duplicated `/en/` and `/la/` pages merely to show an English label alongside a Latin chant. For genuinely translated editorial pages in future, separate language URLs and appropriate language-alternate annotations become relevant. Avoid maintaining two full parallel texts merely for presumed SEO gains.

Google recommends clear primary page language and descriptive titles aligned with the primary content. It determines language from visible content rather than HTML language declarations. Original Latin musical content within an English editorial page is different from maintaining two complete language editions. The bilingual headings recommendation is an application to this music library, not a Google-specific ranking guarantee.

Sources checked 19 October 2026: [Google title-link guidance](https://developers.google.com/search/docs/appearance/title-link), [Google multilingual-site guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites).

Before a URL or title migration, establish Search Console baselines for English and Latin queries, landing pages, impressions, clicks, and indexing. Use those observations to choose targeted improvements rather than replacing Latin terminology wholesale.

## Mockup scope

The accompanying design study compares a Roman gradual direction with a more archival Mechelen direction. Both retain the service-first hierarchy and provide home, sample service, and source-library views. The sample service is 29 November 2026, First Sunday of Advent. English titles and Latin incipits coexist. Additional books and alternative settings are explicitly illustrative; the study does not claim they are imported or available. It does not generate music or implement calendar resolution.

The next design decision is the preferred visual direction and how much collection browsing should appear on the opening screen. Architecture should be tested against the representative multi-source sample before writing the implementation plan.
