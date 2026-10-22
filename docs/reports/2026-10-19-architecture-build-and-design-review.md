# Cantus Organi: build, architecture, URLs, and visual direction

Status: PROPOSAL, not approved. Its product framing ("find music for a date" first) is superseded by the 2026-10-20 reading-edition correction; see docs/design/README.md.

Review date: 19 October 2026. Baseline: `9a8d406`, with pre-existing local agent-memory changes left untouched.

## Recommendation

Refactor selectively. Keep Astro, the static public site, the reviewed data model, and the distinction between original scans and approved typeset music. The main problems are orchestration drift, repeated work, inconsistent navigation, and a few oversized coordinators. A replacement application or framework would introduce substantial migration work without addressing the strongest findings.

The user confirmed the primary journey: **find music for a particular date or service**. Success means a visitor can choose the date and calendar, see the correct Mass and evening office, reach the music, and export it with minimal navigation. Collection browsing remains important, but secondary.

This is an audit and proposed direction, not an approved implementation specification. No product code, route policy, generated catalogue, or deployment was changed.

Follow-up: [multiple sources, English/Latin, and the proposed information architecture](2026-10-19-multiple-sources-and-language-direction.md) extends this review to other accompaniment books, hymnals, and unaccompanied chant editions.

## Coverage and evidence limits

Reviewed the entry points and dependency boundaries across root scripts, Python ingestion/cataloguing/corrections/typesetting, web build scripts, all public route families, calendar and Vespers resolution, SEO/discovery, frontend score/export/admin code, the corrections Worker, and CI workflows. Used three independent read-only reviews for pipeline, routing, and frontend, plus local build measurements and visual inspection of the live homepage.

The source inventory includes 89 Python pipeline files, five root scripts, three tool files, 28 web scripts, 249 files under `web/src` including tests/styles/templates, two Functions adapters, and three Worker source files. This is an architectural review across those areas, not a claim that every line received a correctness or security audit. Experimental web scripts are separate from production build dependencies; their existence alone is not a build cost.

No full Python, unit, or browser test suite was run. CI findings come from workflow/code inspection; no GitHub run timings or Search Console data were fetched. Browser interaction bugs below are explicitly distinguished from reproduced build failures.

## Measured local build

Built to `/private/tmp/cantus-audit-20261019-dist` with installed packages, Node 26.11.1, pnpm 10.33.2, the public asset/API origins, and Cloudflare's documented test Turnstile key. Invoked Astro directly to avoid waiting for the local 1Password named pipe; then ran the post-build stages separately. Existing `web/dist` was preserved. These are one-run local observations, not cold CI timings or promised improvements.

| Stage | Observed wall time | Result |
| --- | ---: | --- |
| Astro build, process total | 26.87 s | 1,743 HTML pages rendered |
| Static entrypoint bundling, within Astro | 3.87 s | Completed |
| Client bundling, within Astro | 14.89 s | Completed; large-chunk warnings |
| Route generation, within Astro | approximately 5 s | From build log timestamps |
| Metadata validation and sitemap | 0.65 s | 1,716 canonical URLs; passed |
| Pagefind, process total | 5.60 s | 1,716 pages indexed |
| Reachability/link validation | 1.75 s | **Failed: four orphan pages** |
| Fixture-content guard | 1.21 s | Passed when run separately |

The separate stages total approximately 36 seconds, but the real package build would stop at the failed link check. These measurements exclude install, Python checks, browser tests, asset publishing, upload, and the environment wrapper. They also omit the package script's removal of local `dist/systems`; this audit left copied assets alone.

The four orphan paths are `/day/commune/C10Pasc/`, `/day/commune/C10b/`, `/day/commune/C10c/`, and `/day/commune/C10t/`. They are rendered but cannot be reached from `/` according to the existing checker. Preserve this guard and repair the navigation or deliberate route policy before claiming a green baseline.

Client bundling costs more than route rendering here. Simply replacing date paths with words cannot eliminate bundling work. The environment wrapper can add a separate wait: `web/scripts/with-public-env.ts:18` sets a 30-second named-pipe timeout, and reads the file before merging existing environment values. That is a potential local delay, not a measured delay in this run.

Built HTML totals 145,660,339 bytes, about 139 MiB, before compression. Current output includes an 8.22 MB Verovio chunk, a 5.79 MB MEI manifest chunk, approximately 1.27/1.24 MB layout worker chunks, and a 426.7 KB export-bar chunk. These are emitted, uncompressed file sizes, not proof that every visitor downloads them. Custom export is already loaded on demand.

Logs: `/private/tmp/cantus-audit-20261019-build.log` and `/private/tmp/cantus-audit-20261019-pagefind.log`. Temporary files may disappear; the measurements above are retained here.

## Priority findings

### 1. Publishing gates unrelated site validation and deployment

`.github/workflows/site.yml:49` starts typeset rendering unconditionally, and `:117` makes the main check/build/deploy job depend on render and upload. A stylesheet change therefore waits for LilyPond setup and checks of published music before ordinary validation can begin.

`pipeline/typeset/publish.py:39` checks four assets for each render hash. `render_missing` at `:123` checks the manifest and review inventory; `remote_problems` at `:183` later checks the matched inventory again. Current data has 846 total unique hashes, including 782 matched hashes. If all files are published and respond successfully, that path makes `(846 + 782) × 4 = 6,512` HEAD requests per workflow run. Sixteen hashes are checked concurrently; each hash's four requests are serial. This is a calculated request count, not a measured network duration.

Proposed change: start independent validation immediately, run render/publish only when its inputs change, and share a verified asset inventory within the run. Preserve publication verification for new or changed assets and use a separate periodic full audit for remote availability. Define the dependency set carefully: sources, includes, house styles, tool versions, manifests, renderer code, and relevant configuration.

### 2. CI has two correctness gaps worth fixing before optimization

The slow MEI precheck skips without `web/node_modules/verovio` (`tests/test_mei_precheck.py:27`). The main job installs web packages but excludes slow tests; the slow job installs Python/Tesseract without those web dependencies (`.github/workflows/site.yml:323`). Thus this intended CI coverage is skipped under that setup. Assign dependency-bearing MEI tests to an appropriately provisioned job, and report unexpected skips.

In `.github/workflows/mei-stale.yml:43`, the prior-revision setup runs inside `prior` but checks `prior/pyproject.toml` and creates `prior/vendor`. Those resolve beneath `prior/prior`, so the normal prior checkout is not prepared. Later conversion checks `prior/.venv` and cannot perform the intended old/new comparison. Correct the paths and verify the preparation behavior with a temporary directory fixture.

### 3. Generated-output ownership is inconsistent

`pipeline/corrections.py:976` has a narrow catalogue writer; `:1018` has a broader writer for catalogue, lineup, log, reviews, and typeset manifests. Catalogue rebuild and triage use the narrow path (`pipeline/catalog.py:851`, `tools/triage/main.py:314`). Shell scripts and workflows each encode their own sequences for restoring related generated outputs.

Create one dependency-aware generation entry point with explicit input/output ownership. Keep domain functions separate; the orchestrator decides what needs rebuilding. First document the real graph and compare outputs across entry points. Avoid introducing a generic build framework until the small graph warrants one.

`scripts/regenerate.sh:32` and `:43` run two correction passes. Both may be needed around matching, so removing one blindly is unsafe. Each full pass already rebuilds typeset manifests (`pipeline/corrections.py:1030`), making the subsequent standalone manifest generation a concrete redundancy when no relevant inputs have changed. `pipeline/typeset/match.py:460` also requests events before filtering preserved editor decisions; move that filter earlier where behavior permits.

### 4. Stable pages contain changing information frozen at build time

`web/src/pages/day/[flex]/[name].astro:37` calculates the next occurrence, Ordinary suggestion, export season, and Vespers links during the build. Those become outdated between deployments. `web/src/lib/liturgy.ts:366` searches only three years, which can miss an infrequent resumed Sunday even though later calendar data exists.

Separate stable occasion/music content from date selection. Use a small occurrence index or browser-side date resolution for changing guidance, retaining useful static content and explicit date context. Include a deterministic build-date input for reproducibility if any build-time date behavior remains.

### 5. Calendar navigation does not consistently preserve the selected service

The EF calendar links Vesperale source records rather than the selected date's complete sung lineup (`web/src/pages/calendar/index.astro:157`, `:197`). A detour through a recurring day page can then switch to the next occurrence calculated at build time.

Centralize service resolution and link generation. The calendar should resolve its selected date directly to Mass and the actual evening office, including First Vespers of tomorrow where applicable. The Vespers page already contains part of this distinction (`web/src/components/VespersPage.astro:27`). Preserve original source pages as provenance and alternate settings, while making their role clear to visitors.

### 6. Frontend behavior needs targeted consolidation

`web/src/components/SystemStack.astro:252` contains an inline script that queries all score elements. A piece can render several stacks (`web/src/pages/piece/[slug].astro:98`), allowing later inline scripts to bind handlers again to earlier stacks. Multiple toggles per click are a code-derived risk, not a reproduced browser bug in this audit. Confirm with a multi-stack interaction test, then initialize once with an explicit guard or local scope.

Quick PDF export disables its button and handles worker messages but has no worker-load error, message error, or timeout recovery (`web/src/components/ExportBar.astro:244`). Reuse the lifecycle principles already implemented in the custom-export controller. Test startup failure and recovery, not just successful PDF creation.

The export bar imports lightweight selection helpers from a module importing `pdf-lib` (`ExportBar.astro:124`, `web/src/lib/pdf.ts:1`). Extract the pure selection/estimate rules and compare the emitted bundle graph and size before/after. Tree shaking means the import alone is not proof of every dependency's inclusion.

Share score slots, loading/error presentation, and initialization between `SystemStack` and `LineupStack`, while retaining their distinct Mass/Vespers data assembly. Extract controls and announcements from the 931-line `web/src/scripts/exportLayout.ts` along its existing controller/preview/session seams. Finish shared admin API and filter/control styling boundaries instead of replacing the admin application.

### 7. Cache and check contracts need explicit maintenance

`pipeline/render.py:24` caches a raster by volume/page only, ignoring requested DPI and PDF identity. That can reuse an incompatible render unless forced. Include source fingerprint and rendering configuration, following the stronger typeset cache pattern. This concerns ingestion correctness, not normal Astro route rendering.

Local checks install web packages after Python tests (`scripts/check.sh:19`, `:29`), unlike CI, permitting dependency-based skips on a fresh checkout. They also omit the separate CI fixture-export build/browser suite. Align shared check definitions and document which suites need which dependencies. Existing comments describing immutable page counts and job durations are stale; refresh them from measurements.

## URLs: distinguish occasion, date, and source

The site already has recurring Mass pages. Current rendered route families are:

| Route family | Pages | Meaning |
| --- | ---: | --- |
| `/day/<flex>/<name>/` | 466 | Recurring 1962 occasions |
| `/ordinary-form/<key>/` | 83 | Recurring Ordinary Form occasions |
| `/piece/<slug>/` | 576 | Source music records, including 18 redirects |
| `/kyriale/<mass>/` | 18 | Ordinaries |
| `/vespers/<date>/` | 468 | Dated main/Second Vespers |
| `/vespers/<date>/i/` | 110 | Dated First Vespers |

The Vespers family has 579 HTML files including its index. Other indexes, utilities, calendars, and admin pages account for the rest of the 1,743 HTML files. There are also 1,359 chant JSON routes; JSON endpoints are not included in that HTML count.

Calendar source data spans 2024–2050; the generated Vespers window spans 2025–2031. Its 578 dated lineups cover 70 offices and 87 office/phase combinations. Comparing item payloads while removing their date-specific `item_key` leaves **137 distinct item variants**, and 28 office/phase combinations vary across dates. This is not a count of interchangeable whole pages: headings, dates, notices, exports, and navigation also matter.

For example, Fifth Sunday after Epiphany uses Ave Regina on 9 February 2025 but Salve Regina when resumed on 8 November 2026. Seasonal Marian antiphons, commemorations, O antiphons, and First versus Second Vespers prevent a universal one-Sunday-one-lineup replacement.

Three approaches:

1. **Keep current routes and improve their relationship — recommended first.** Use existing recurring Mass pages, add readable recurring Vespers hubs, and retain exact dated services. Make calendar navigation direct and reduce long date lists to upcoming services plus accessible archives. Lowest migration risk; preserves static, usable scores. Modest page-count savings initially.
2. **Recurring pages with explicit date/season variants.** Render stable office content once and resolve the requested date against documented variants. This can reduce repeated HTML, but needs careful fallback, export, accessibility, and no-JavaScript decisions. Prototype after measuring approach 1; do not assume all 578 dates are duplicates.
3. **Render dated services on demand.** Could reduce static output, but adds server/runtime/cache dependencies and operational work. The measured five-second route-generation phase does not presently justify that trade-off by itself.

Readable Vespers hubs such as `/vespers/fifth-sunday-after-epiphany/` are illustrative, not an approved naming scheme. Keep liturgical calendar identity explicit if expanding this to both calendars. Maintain internal observance keys independently of display slugs. Existing `/piece/dominica-i-adventus/` already provides a descriptive source URL; another alias is not automatically useful.

Google recommends descriptive URLs, canonical signals for duplicate or very similar pages, and mapped permanent redirects when URLs move. Dates themselves are not a reason to migrate a useful page. Apply canonical consolidation only to genuinely equivalent content; preserve accurate pages for materially different services. See [URL structure guidance](https://developers.google.com/search/docs/crawling-indexing/url-structure), [canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), and [URL migration guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).

Current layout and discovery validation require self-canonicals and indexable public pages (`web/src/components/Layout.astro:19`, `web/scripts/build-discovery.ts:31`). Any consolidation must update layout capability, SEO policy, sitemap validation, Pagefind inclusion, tests, and URL producers together. Do not simply add a new canonical tag and leave contradictory checks or indexes.

The rolling window eventually removes old dated routes (`pipeline/vespers/lineup.py:284`). Decide to retain published archives or provide faithful replacements before advancing it. A historic service must not silently become next year's service. Audit inbound links and Search Console before a broad migration; this review has no traffic evidence establishing which paths already perform well.

## Visual direction: a working liturgical edition

The live homepage currently has restrained typography and repeated bordered cards, with no substantial identity artwork. The existing tokens already specify warm paper, black ink, rubric red, fine rules, and small radii (`web/src/styles/tokens.css:1`). This is a useful foundation. Source Serif 4 is declared but is not actually loaded, so the display generally falls back to Georgia.

Recommended direction: **a printed Roman gradual adapted for service preparation**. A distinctive masthead, carefully chosen and actually loaded serif, rubric headings, an ornamental initial, and one authentic score/title-page detail could establish the identity. Graphics should belong mainly on home, browse, and about pages. The score itself should remain the main visual on working pages.

The home hierarchy should prioritize Today, Next Sunday, and Choose a date; preserve a clear EF/OF choice. Once selected, carry date and calendar through to Mass, Vespers, and export. Place browse-by-Sunday/feast and browse-by-book below that workflow. Avoid presenting a source record, service page, and date selector as interchangeable destinations.

Two alternatives worth comparing visually are an **archival Mechelen edition**, emphasizing folios, title-page details, provenance and volume indexes; and a **quiet organ loft**, using a single monochrome organ engraving or commissioned line illustration. The former emphasizes the collection; the latter gives a stronger musical identity. The printed-gradual approach best fits the confirmed service-first purpose and existing palette.

Preserve 44px touch targets, strong contrast, polarity inversion, keyboard focus, skip-to-music links, stable image dimensions, readable score scale, and clean printing. Keep ornaments out of score backgrounds and exported music. Audit control borders in both polarities: some use pale `--rule` even though `--control-border` exists for stronger contrast. Self-host/subset fonts where licensing allows and set artwork/font budgets. Avoid adding an animation or image pipeline without a concrete need.

## Suggested sequence and acceptance criteria

1. **Restore a trustworthy baseline.** Repair the four orphan routes and CI prior-revision/MEI-test gaps. Record the same stage timings on local and CI runs. Acceptance: all intended checks execute, no unexpected skips, and link validation passes.
2. **Improve build orchestration.** Gate asset work by real inputs; start independent checks immediately; reuse publication evidence. Acceptance: a CSS-only change does not invoke LilyPond or repeat the full remote corpus inventory, while changed assets are still checked before deployment.
3. **Clarify generation and frontend ownership.** Consolidate generation contracts, remove proven duplicate work, initialize scores once, add export recovery, and index repeated catalogue/lineup queries. Acceptance: equivalent commands produce the same generated artifacts; interaction fault cases recover; measured output and bundle changes are documented.
4. **Unify the service journey and URL model.** Centralize date/calendar/occasion/phase resolution, retain old published links, then introduce recurring Vespers discovery. Acceptance: selected-date navigation and exports agree, including resumed Sundays, seasonal variants, Christmas Eve, First Vespers, and OF transfer/cycle cases.
5. **Compare visual concepts before implementing the redesign.** Apply the selected direction to home, a date/service result, a music page, and mobile/tablet views. Acceptance: the service workflow is clearer and the identity more solemn without reducing score readability, print quality, accessibility, or loading performance.

These are proposed work packages, not a task-by-task implementation plan. Under the requested Superpowers brainstorming process, agree on the architectural direction, then write and review a scoped design specification before implementation planning. Treat the build cleanup and visual redesign as separate, coordinated projects so neither requires a large simultaneous migration.
