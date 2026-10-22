# Cantus Organi: platform options for more collections

Date: 2026-10-23

Status: Decided 2026-10-22 as P14 (was Q1), P15 (was Q2) and P16 (was Q7); see `docs/DECISIONS.md`.

| Criterion | A: static public site + ingestion | B: Astro with database and some SSR | C: SvelteKit or Next application |
|---|---|---|---|
| 1. Data model | Shared identities; versioned publication snapshots | Same identities; database owns catalogue | Same identities; database and account model |
| 2. Ingestion | Reuse Python behind a private queue | Same Python; database job state | Same Python; richer contributor workspace |
| 3. Rights and moderation | Explicit approval before publication | Approval plus draft/public query separation | Approval plus roles, sessions and account abuse |
| 4. URLs and SEO | Preserve paths; add useful source/work pages | Preserve paths; runtime redirects and discovery | Preserve paths; port routing and discovery checks |
| 5. Reader experience | Published music survives database failure | Static pages survive; uncached SSR needs fallback | Greatest runtime dependency and migration risk |
| 6. Cost | Lowest runtime cost; output limits matter | Small database cost; traffic and caching matter | Similar hosting floor; more operational work |
| 7. Effort and risk | About 6–10 person-weeks for a narrow pilot | About 10–16 including common ingestion work | About 16–26 including migration and accounts |
| 8. Fit | Closest to brief and P8/P9/P12 | Fits if the reader stays continuous | Requires a separate scope decision |

**Recommendation: A now, with parts of B later if measurements call for them.** The view under test was "keep the public site static; the real work is the data model, the catalogue store, ingestion and rights". It holds. The hard parts of a second book are NOH-specific identities, schemas and scan processing, and no framework removes them. Rendering is not the bottleneck today: generating the routes took about 5 seconds in the last recorded build.

One qualification to the view: **the first limit to arrive is the number of files in a deploy, not build time.** At about 10× today's catalogue, the site passes Cloudflare Pages' 20,000-file limit for the Free plan; at about 50× it nears the 100,000-file paid limit. That can be fixed without SSR, by moving per-chant JSON and search files to R2 or splitting them by source, but it has to be planned.

So: keep published music static, put submissions and job state in D1, and run the native Python processing in an isolated runner or container. Accounts alone do not require replacing Astro. Everything here is a proposal, including the effort estimates; Q1 and Q2 remain proposed (`docs/DECISIONS.md`).

## What the evidence says about today

Measurements were taken on 22 October 2026. Paths are repository-relative unless absolute. The `web/dist` counts come from the maintainer's local build of 20 October, not from production. No build, remote command, upload or workflow was run for this analysis.

| Observation | Evidence and method |
|---|---|
| **576 pieces**, all with distinct slugs | Parsed `data/catalog.json`, counted `pieces` and distinct `slug` values; schema version 3. |
| Catalogue **2,569,798 bytes** (2.45 MiB); chants **991,295 bytes** (0.95 MiB), **1,379 chant records** | Filesystem byte counts and JSON parsing of `data/catalog.json` and `data/chants.json`; uncompressed sizes. |
| **1,744 HTML files**, **1,379 chant JSON files**, **5,018 files total** | Recursive count in `/Users/npadley/development/nova-organi-harmonia-online/web/dist`; newest HTML modification 2026-10-20 04:51 UTC. Includes redirects, admin and utilities; no `systems/` directory. |
| HTML families: piece 576; day 466; Vespers 579; OF 83; Kyriale 19; admin 6; other 15 | Same `web/dist` count. Vespers includes its index; Kyriale includes 18 Masses and index. HTML totals **145,697,673 bytes**. Pagefind adds **1,806 files**. |
| Route generation comes from data, not a fixed page count | `web/src/pages/piece/[slug].astro:20`, `day/[flex]/[name].astro:15`, `ordinary-form/[key].astro:12`, `vespers/[date].astro`, `vespers/[date]/i.astro`, `chant/[id].json.ts`. Paths after the first are under `web/src/pages/`. The 2,445-page comment in `web/astro.config.mjs` is not the measured HTML count. |
| Prior local Astro run: **26.87 seconds** process time; **4.89 seconds** route generation; Pagefind **5.60 seconds** process time | Logs kept from the 19 October architecture review's local build (`/private/tmp/cantus-audit-20261019-build.log` and `…-pagefind.log`, on the maintainer's machine, not in the repository). That run generated 1,743 pages. Historical figures, not a fresh benchmark of this branch. |
| Full package build and CI duration **not newly verified** | `docs/reports/2026-10-19-architecture-build-and-design-review.md` records about 36 seconds across local stages, with a failed reachability check. `docs/OPERATIONS.md:323` says site CI about four minutes; no run logs were fetched to validate that estimate. |

The workflow includes much more than HTML generation: typeset render/upload gates the main checks, followed by Python, TypeScript, Worker and browser checks, an export fixture build, remote asset verification and deployment. Scan and LilyPond tests have separate jobs. Job timeouts are ceilings, not measurements; a framework change would not remove this work (`.github/workflows/site.yml`, `web/package.json`).

`Piece` mixes source, calendar, music and representation fields. Its generated ID is `<volume>-<slug>`, while corrections and routes often use the slug alone (`web/src/lib/catalog.ts:108`, `pipeline/catalog.py:618`, `pipeline/corrections.py:272`, `web/src/pages/piece/[slug].astro`). `pipeline/index.py:18` normalizes labels into lowercase hyphenated slugs; reviewed indexes can supply explicit slugs, with page suffixes for collisions within a volume. OCR proposals use a cleaned title or `<volume>-p<page>` fallback and numeric disambiguation (`pipeline/index.py:85`, `pipeline/indexextract/proposals.py:473`). **21 current slugs start with `noh`**, including source/page fallbacks (`data/catalog.json`). Neither title equality nor today's volume-local collision handling establishes a global musical identity.

The old report calls the source-label function `sourceLabel`; this checkout calls it `volumeLabel`, and it still emits “Nova Organi Harmonia.” Related hymn settings still filter to `noh7`; the general hymn index is broader (`web/src/lib/catalog.ts:456`, `:704`, `:733`). Correction patterns explicitly require `noh\d` system ranges and `noh8` Vespers refs (`data/schema/corrections.json`). These are concrete migration seams, not evidence for replacing the UI framework.

Seven registered scans are an allowlist with checksums, page mappings and per-page slicing exceptions; source URL, retrieval date and provenance are currently null. The registry is not a submission or rights-review system (`data/volumes.yml`, `pipeline/volumes.py`). Segmentation constants were measured against NOH5; Proper ordering, Latin margin labels and index-heading recognition encode NOH conventions (`pipeline/segment.py`, `pipeline/parts.py`, `pipeline/indexextract/`). Adding a book needs an adapter and representative page review, not just another registry row.

R2 scan keys are `systems/<volume>/<PDF-page:04>/<system:03>-<sha12>` with `.webp`, `@2x.webp` and `@2x.png` variants. Fixed typesetting uses `typeset/<render-hash>/`; MEI uses `mei/<sha256>/{score.mei,boundaries.json}`. Preserve these existing keys; new source identifiers can be namespaced independently. Scan uploads skip existing keys and use one-year immutable caching; MEI additionally verifies bytes and uses conditional writes (`pipeline/publish.py:225`, `pipeline/upload.py`, `pipeline/typeset/publish.py`, `pipeline/typeset/mei/publish.py`). Local metadata does not establish current R2 storage or request charges.

There is already a small application behind the static reader: Access JWT verification plus an `EDITORS` allowlist, Pages Functions, a GitHub App/webhook, and D1 editorial state. Migrations 0001–0008 cover reports, approval/batches/audit, review fingerprints, deduplication/resolution, typeset drafts/snapshots and previews, not a general catalogue (`web/src/lib/admin/auth.ts`, `api.ts`, `store.ts`, `github.ts`; `web/functions/`; `web/wrangler.toml`; `workers/corrections/migrations/`). Reader intake uses Turnstile, an Origin check, an 8 KiB declared-body limit and five reports/hour per hashed IP; the count and insert are separate, so this is not an atomic upload quota (`workers/corrections/src/index.ts:23`).

**Publication needs a new boundary.** The scan publish workflow uploads before opening its catalogue PR; eligible correction batches auto-merge. Do not route contributed books through either path unchanged. P11 requires maintainer approval; technical checks and editor acceptance must not become permission to expose an unreviewed submission (`.github/workflows/publish.yml`, `.github/workflows/corrections-batch.yml:161`, `docs/DECISIONS.md`, P11).

The uncommitted redesign brief **does contain “Future: multiple sources”**, §5, at read time. It requires inline settings, source and rights information, one chosen setting per included PDF part, a contribution placeholder and additive routes. It keeps static Astro and does not approve imports or Q2. This is a moving input, not a merged decision (`/Users/npadley/development/nova-organi-harmonia-online/.claude/worktrees/redesign-brief-5bd60c/docs/redesign/brief.md:254`; called **the brief** below).

### Shared scale and cost assumptions

“10×” means **5,760 pieces**; “50×” means **28,800**. These are scenarios, not demand forecasts. Multiplying today's two JSON files gives roughly **35.61 MB** and **178.05 MB** combined, versus **3.56 MB** now; database indexes, history, drafts and assets are additional. Do not send an entire expanded catalogue to every reader (`data/catalog.json`, `data/chants.json`, measured above).

Holding non-piece HTML fixed gives **6,928 / 29,968 HTML files** at 10×/50×. If chant JSON grows proportionally too, HTML plus chant JSON alone reaches **20,718 / 98,918**, before bundles, Pagefind or new source/work pages. This is a deliberately simple calculation from the measured `web/dist` families, not a prediction that calendars grow with books. It shows an output limit can arrive before slow rendering.

Published limits checked **2026-10-22**:

| Service | Limit or price used in this comparison |
|---|---|
| Pages | Free: 20,000 files/site; paid plans: 100,000 with the documented Wrangler setting; 25 MiB/file. Hosted builds: 500/month Free, 20-minute timeout. The repository deploys from Actions via direct upload, so hosted-build duration is not its current CI ceiling. Paid Pages plan price: **check**. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/); `.github/workflows/site.yml`. |
| Workers / Pages Functions | Free: 100,000 requests/day, 10 ms CPU/invocation. Paid: minimum $5/month, including 10 million requests and 30 million CPU ms/month; overages $0.30/million requests and $0.02/million CPU ms. Static asset requests are free; runtime/cache routing affects billing. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |
| D1 | Free: 5 million rows read/day, 100,000 written/day, 5 GB/account but **500 MB/database**. Paid: 10 GB/database; 25 billion reads and 50 million writes/month, 5 GB storage included; overages $0.001/million reads, $1/million writes, $0.75/GB-month. Index writes also count. [Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/). |
| R2 Standard | 10 GB-month, 1 million Class A and 10 million Class B operations/month free; then $0.015/GB-month, $4.50/million A, $0.36/million B; no egress charge. Billing rounds up units. [R2 pricing](https://developers.cloudflare.com/r2/pricing/). |
| Neon alternative | Current page lists Free 1 GB/project and 100 CU-hours/month/project; Launch $0.106/CU-hour plus $0.35/GB-month. Compute, history and transfer make catalogue bytes an incomplete estimate; check total terms at purchase. [Neon pricing](https://neon.com/pricing). |
| Processing | Standard hosted Actions runners are free for public repositories. Private ingestion, artifact retention, a container service and account/email providers need a separate quote; do not assume unreviewed material can be exposed in public logs/artifacts to obtain free compute. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). |

For an explicit asset scenario, assume **10 MB per piece** for retained originals and derivatives, with deduplication already accounted for. That gives 5.76 / 57.6 / 288 GB at 1×/10×/50×: approximately **$0 / $0.72 / $4.17 monthly R2 storage** after the free tier and rounding, excluding operations and other account use. This is an illustration, not a measurement of NOH assets; originals, multiple formats and retained versions may dominate.

## Option A: static public site with submission and ingestion

### 1. Data model

Adopt opaque IDs for works/texts, chant or tune variants, musical settings (including accompaniments), source collections/editions/items, and digital representations. A work can have several melodies; a chant can have several accompaniments; an edition item can contain several parts; a setting can appear in several editions. Keep liturgical assignments separate. Store external catalogue IDs as references and uncertain matches as review candidates, never merge by incipit alone. This develops Q2 and the distinctions already proposed in `docs/reports/2026-10-19-multiple-sources-and-language-direction.md`.

Keep NOH as an import adapter. Add a permanent mapping from old piece IDs, slugs, part targets and anchors to new IDs; leave the old URLs and R2 keys intact. Preserve P2: base import plus ordered corrections containing `was`, provenance and review fingerprints; resolve old targets through aliases before replay. Initially keep reviewed catalogue sources/overlays in git and generate a source-neutral publication snapshot. D1 owns submissions and jobs only, avoiding two catalogue masters. A later editorial database can export the same snapshot (`pipeline/corrections.py`, `data/schema/corrections.json`, `docs/DECISIONS.md`, P2).

### 2. Ingestion

Proposed flow: contributor contact/rights form → maintainer admits upload → expiring upload capability to private R2 quarantine → checksum/type/page/size checks → queued processing → slice/OCR/index proposals → human review of pages, relationships and rights → maintainer approves exact release → verified public artifacts → versioned catalogue snapshot → site build/deploy. Use idempotent jobs keyed by source digest, adapter/tool versions and parameters; retry a failed page without redoing a volume. Never let an upload callback publish.

Workers can authenticate, validate metadata, issue upload capabilities, update D1 and enqueue/poll jobs. **This native Python + Tesseract + LilyPond pipeline cannot run inside a Worker isolate**: Python Workers use Pyodide/WebAssembly, not a native subprocess host. Run it in a locked-down Linux runner/container; separate untrusted parsing/engraving from the credential-bearing publisher. Where that runs is an open choice for phase 3: an Actions runner in a private repository (so unreviewed scans never appear in this public repository's logs or artifacts), or a container service such as Cloudflare Containers (check availability and pricing first). Either way the existing `noh` CLI is the job's entry point ([Python Workers](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/); `pipeline/indexextract/pages.py`, `pipeline/typeset/mei/extract.py`, `.github/workflows/corrections-batch.yml:36`).

Reuse rendering, segmentation primitives, slicing/hash manifests, OCR table extraction, review evidence, overlay replay and MEI validation. Adapt staff grouping, page maps, heading vocabulary, divisions, part order and calendar matching per collection; hymnals and four-line chant need fixtures before reuse is trusted. OCR text does not produce approved music notation. The existing CLI exposes index proposals, catalogue generation and independent slicing/upload, but workflows hard-code the NOH volumes (`pipeline/cli.py`, `segment.py`, `parts.py`, `indexextract/`, `.github/workflows/publish.yml`, `.github/workflows/catalog-rebuild.yml`).

### 3. Rights and moderation

Require a licence or evidenced public-domain declaration for each edition and contributed accompaniment/representation: author/editor, publication place/date, source URL or scan provenance, checksum, attribution, jurisdiction basis, permission evidence and display/export permissions. Keep private contact details separate from public credit. An unchecked declaration stays private; indexing-only publication can link to a lawful external source after review. Do not extend NOH's repository licensing statement to new books (`data/LICENSES.md`, `data/volumes.yml`).

Start with verified contact and invitations, not public reader accounts. Apply Turnstile, atomic admission quotas, actual streamed-byte limits, file validation and processing budgets; hashing an IP is neither contributor identity nor rights evidence. Reuse the existing intake patterns, not its correction-sized payload contract (`workers/corrections/src/index.ts`). Bind maintainer approval to the release hash and rights record, with a separate public-promotion action under P11 (`docs/DECISIONS.md`).

Provide a takedown contact and audited withdrawal state. Remove discovery/export eligibility and redeploy affected pages; for disputed assets, the maintainer must also be able to block delivery and purge CDN copies. Ordinary MEI rollback currently retains immutable assets, so that alone is **not a rights takedown**; an emergency suppression procedure needs explicit approval before public submissions launch. Previously downloaded PDFs cannot be recalled (`docs/TYPESETTING.md`, “Release sequence”).

### 4. URLs and SEO

Keep `/piece/<old-slug>/`, day, Kyriale and dated Vespers paths and anchors. Add edition-scoped new item routes and useful work/chant hubs; reserve permanent slugs with stable disambiguators. One chant hub lists its accompaniments, but distinct arrangements and source records retain self-canonicals. Consolidate only truly equivalent pages, never every accompaniment onto its chant (`web/src/pages/`, `web/src/components/Layout.astro`, `docs/SEO.md`).

Keep an alias registry for unavoidable moves, generating 301s and testing every old address. Pages `_redirects` allows 2,000 static plus 100 dynamic rules; use Bulk Redirects or a narrow alias Function if necessary, after checking its plan limits. There are two explicit rules today; generated Kyriale redirect HTML is a separate route mechanism. Changes to canonicals must also change sitemap/Pagefind validation (`web/public/_redirects`, `web/src/pages/piece/[slug].astro:29`, `web/scripts/build-discovery.ts`; [Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/)).

### 5. Reader experience

Serve complete published reading pages and per-page data from the CDN; choose alternate settings inline and feed a single selection snapshot to both exports. Keep scan/typeset choice, chant modes, inversion, skip links and print. These are product obligations, not optional conveniences (`docs/DECISIONS.md`, P8/P9; the brief §5).

Quick remains browser PDF assembly from scans or fixed typeset PDFs, with Letter/A4 and scan fallback; it does not include chant. Customize keeps approved MEI/Verovio reflow and chant options, with fixed pages/scans for material that cannot reflow. A scan-only import is useful before transcription exists (`web/src/lib/pdf.ts`, `web/src/workers/pdf.worker.ts`, `web/src/lib/export-layout/`, `docs/TYPESETTING.md`, `docs/superpowers/plans/export-layout-decisions.md`, D23/D28).

A database or ingestion outage stops new work, not the published reader. R2 or asset-network failure can still stop new images and exports. The saved PDF is the offline copy; static hosting does not create an offline application, and no service-worker registration or web app manifest was found in `web/src/` or `web/public/`. Do not promise offline Customize without a separate asset-caching design.

### 6. Cost

At 576 pieces, catalogue files are small enough that a new public database is not justified by storage alone; D1 submission state could fit Free under light intake, subject to actual row usage. At 5,760, split snapshots by source/work and test file counts: the shared scenario already exceeds 20,000 files before search. At 28,800, use a larger static-hosting allowance or move generated chant/search assets to R2; about 98,918 HTML/chant files leaves little room under 100,000. None of this automatically requires SSR. Apply the shared R2 estimate and D1/Functions limits, not a flat “free forever” claim (`data/catalog.json`; measured `web/dist`; published limits above).

Do not multiply four-minute CI by 10 or 50. A deliberately crude extrapolation of the old **4.89-second route stage alone** gives 49 seconds / 4.1 minutes if routes grew proportionally; bundling, Pagefind, validation, artifact checks and upload differ. Benchmark source-shaped samples and gate expensive ingestion by changed hashes. No current-branch 10×/50× build was measured (`/private/tmp/cantus-audit-20261019-build.log`, `.github/workflows/site.yml`, `web/package.json`).

### 7. Effort and risk

Estimate: model/alias adapter and a small second-source reader **M, 2–3 weeks**; private intake, isolated processing and rights/review gates **L, 3–5**; failure tests, restore drill and release controls **M, 1–2**. Total **6–10 person-weeks**, excluding full-book proofreading, rights clearance and new notation support. Ship the reviewed sample first; source adapters may be the largest unknown (`pipeline/segment.py`, `parts.py`, `typeset/mei/`).

Reverse phase one by disabling the new collection projection while retaining IDs/aliases; reverse intake by closing admission and retaining private evidence; reverse a release by selecting the previous snapshot and manifest. Do not discard corrections or overwrite public assets. Use new migrations with rollback files, following the repository rule (`AGENTS.md`; `workers/corrections/rollback/`; `docs/TYPESETTING.md`, “Release sequence”).

### 8. Fit

A matches the brief's static constraint and future-source section. Put alternatives and licence/citation information beside music, not behind an account wall or a part-by-part wizard. Accept only a pilot that preserves all P9 controls and checks WCAG 2.2 AA plus 7:1 body/music contrast across the reader, admin and PDF preview. Framework continuity reduces the amount to revalidate; it does not prove accessibility (`the brief §§4–5`; `docs/DECISIONS.md`, P8/P9/P12).

## Option B: Astro with a database and some on-demand pages

### 1. Data model

Use exactly A's work/chant/setting/source/representation identities, assignments and legacy alias map. Make D1 or Postgres the editorial catalogue authority, with immutable imported revisions and append-only correction events carrying `was`; derive approved publication revisions transactionally. Import NOH base data and overlay separately, compare the resulting snapshot with today's output, then switch writers once. A database must preserve P2's replay/conflict semantics rather than flatten corrections into mutable rows (`pipeline/corrections.py`, `data/schema/corrections.json`, `docs/DECISIONS.md`, P2/Q2).

Prefer D1 for a modest catalogue and simple transactions near existing Functions; evaluate Postgres for relational reporting, complex editorial transactions or sustained contention. Store binary assets in R2 in either case. Keep deterministic snapshot export, backups and an independently tested restore; changing the database does not require changing public rendering (`web/wrangler.toml`, `workers/corrections/migrations/` establish the existing D1 boundary).

### 2. Ingestion

Keep A's private upload, slicing/OCR/index review and maintainer publish stages. Native Python/Tesseract/LilyPond still run on a runner/container; Workers handle intake, database queries and job coordination. Reuse the same Python modules and collection adapters; add a database/snapshot output adapter, not a rewrite of recognition or MEI (`pipeline/cli.py`, `catalog.py`, `publish.py`, `typeset/mei/`; [Python Workers](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)).

Serve private previews and contributor status on demand first; retain prerendered public reading pages until a measured need justifies dynamic long-tail pages. “Hybrid” here describes mixed rendering, not an assumed `output: 'hybrid'` setting: Astro supports an adapter with per-route prerender choices. Current Cloudflare Astro guidance uses Workers; assess the hosting change and port existing Pages Functions deliberately (`web/astro.config.mjs`, `web/functions/`, `web/wrangler.toml`; [Astro rendering](https://docs.astro.build/en/guides/on-demand-rendering/), [Cloudflare Astro](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)).

### 3. Rights and moderation

Keep the same rights evidence, verified contributor contact, private quarantine, quotas and maintainer release approval as A. Use separate draft and published revisions, with public queries restricted to approved releases; never rely on a hidden UI button to protect drafts. Add role checks and audit records for every transition. Existing editor authentication and audit patterns can help, but are not general contributor accounts (`web/src/lib/admin/auth.ts`, `api.ts`; `workers/corrections/migrations/0002_admin_workflow.sql`).

Withdrawal can immediately exclude a record from new database responses, but cached HTML, static snapshots, search and R2 assets need invalidation/suppression too. Bind cache keys to approved release versions, with a separate withdrawal override. Preserve P11 and the distinction between routine MEI withdrawal and rights takedown (`docs/DECISIONS.md`, P11; `docs/TYPESETTING.md`, “Release sequence”).

### 4. URLs and SEO

Keep A's legacy aliases, source-scoped additions and distinct accompaniment canonicals. SSR is an implementation detail behind the same URL. Functions must implement redirects and response headers themselves where they handle requests: Pages `_redirects` does not apply to Function responses. Preserve the present noindex boundaries and real 404 responses (`web/public/_headers`, `web/public/_redirects`, `web/src/pages/404.astro`; [Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/)).

Generate sitemaps and search documents from the approved catalogue, and test SSR HTML directly: today's discovery and link checks crawl built files, and Pagefind indexes `dist/`. On-demand pages would otherwise be missing from those checks and search. Keep useful chant hubs self-canonical and avoid canonicalizing distinct music together (`web/scripts/build-discovery.ts`, `web/scripts/check-links.ts`, `web/package.json`, `docs/SEO.md`).

### 5. Reader experience

Prerender the frequently used continuous reading pages and retain client-side Quick and Customize. Fetch each chosen setting's immutable representation by release/asset hash; a mid-session catalogue change must not change the exported music. The existing browser workers and MEI approval contracts remain applicable (`web/src/workers/`, `web/src/lib/export-layout/`, `pipeline/typeset/mei/manifest.py`).

If D1/Postgres or SSR fails, static pages still work; uncached dynamic routes fail unless a last-approved snapshot is served independently. Make that fallback an acceptance criterion, with a clear stale-data notice where needed and withdrawal checks. Account actions may be unavailable while reading continues. Offline behaviour remains saved PDFs, not guaranteed offline browsing (`web/src/lib/pdf.ts`; absence of service-worker registration in `web/src/`).

### 6. Cost

At current scale, B adds runtime work without a demonstrated storage need. At 10×/50×, 35.61/178.05 MB of raw catalogue/chant JSON remains below D1's 500 MB/database Free ceiling, but indexes, revision history and drafts can erase that margin. Row scans, not record count alone, determine D1 cost: 1,000 unindexed full-piece-table reads/day would touch 0.576/5.76/28.8 million rows at 1×/10×/50×. That exceeds the free daily read allowance in the latter two cases; indexed lookup and cached snapshots matter (measured `data/catalog.json`; D1 limits/pricing above).

For an illustrative 10,000 / 100,000 / 500,000 SSR requests/month at 20 ms CPU each, Paid Workers stays within its $5 included request/CPU allocation; Free's 10 ms CPU limit would not fit that assumed work. Add database, R2 and ingestion costs. Neon can fit the raw data at all three sizes on its listed Free storage allowance, but active compute/history may require paid service. These are scenarios, not current traffic or bills; rates are in the shared table.

SSR removes generation of the routes moved on demand, but not ingestion, bundling or quality checks; mixed rendering still needs an explicit search/discovery build. Measure the reduction before paying the operational cost. The recorded 4.89-second route stage is weak evidence for converting today's reader (`/private/tmp/cantus-audit-20261019-build.log`, `web/package.json`, `.github/workflows/site.yml`).

### 7. Effort and risk

Estimate **10–16 person-weeks total**: A's common ingestion/model work plus **M/L, 2–3 weeks** for database migration, concurrency and restore; **M/L, 2–3** for selected SSR, cache fallback and discovery parity. Ship a read-only database projection first, then move editorial writes, then one on-demand route family. Do not switch database authority and all reader routes together; current build-time JSON imports are widespread (`web/src/lib/catalog.ts`, `web/src/pages/`).

Reverse the projection by disabling it; reverse the writer cutover only after exporting every accepted event since cutover to the overlay/snapshot contract. Reverse SSR by rebuilding from the last approved snapshot and restoring static routing. Database backup alone is not a lossless application rollback if readers or writers expect a different schema (`pipeline/corrections.py`; migration discipline in `AGENTS.md`).

### 8. Fit

B can satisfy P8/P9/P12 with the same reader, inline choices, exports and accessibility checks. Its database work can sit behind the brief; public SSR or a Pages-to-Workers move needs a separate scope decision because the brief retains static Astro and excludes a platform rewrite. This is the preferred later extension if editorial contention or output limits become real (`the brief §§1, 4–5`; `docs/DECISIONS.md`, P8/P9/P12).

## Option C: SvelteKit or Next with accounts and server rendering

### 1. Data model

Retain A's complete identity model and B's imported revisions, correction events, approved snapshots and legacy aliases. Add users, contributor roles, invitations, ownership of drafts and moderation permissions; authorship of music is distinct from the uploading account. Port P2 with historical `was` checks and alias resolution intact. A framework supplies no musical identity rules (`pipeline/corrections.py`, `web/src/lib/catalog.ts`, `data/schema/corrections.json`; `docs/DECISIONS.md`, P2/Q2).

Choose D1 or Postgres on workload evidence as in B; Postgres is a plausible default for a substantial collaborative editor, not a prerequisite for 28,800 pieces. Keep a database-independent published snapshot so the old static reader remains a viable fallback during migration. Do not regenerate NOH IDs or slugs as an account migration side effect (`pipeline/catalog.py:618`, `pipeline/index.py`).

### 2. Ingestion

Accounts can offer resumable uploads, private drafts, review discussions and submission status in one workspace. The same admitted upload → quarantine → native processing → review → maintainer release chain remains necessary. Reuse Python slicing/OCR/indexing, corrections and MEI through a job API; source-specific adapters remain the hard part (`pipeline/segment.py`, `indexextract/`, `parts.py`, `typeset/mei/`).

SSR actions coordinate processing, not execute Tesseract or LilyPond in a Worker. A native Node server could launch processes, but use isolated jobs anyway so an expensive book cannot block readers. Prototype deployment before choosing a framework: Cloudflare documents SvelteKit and Next Workers integrations, not unrestricted native Node execution ([SvelteKit guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/), [Next guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [Python Workers](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)).

### 3. Rights and moderation

Accounts improve traceability and returning contributors' workflow, not proof of ownership. Keep A's rights evidence, attribution, export restrictions and takedown process. Add session recovery, account deletion/retention rules, contributor/moderator/maintainer separation, object-level access checks and abuse budgets. Keep public reading anonymous. Existing Access authentication covers invited editors, so these are new product and operational responsibilities (`web/src/lib/admin/auth.ts`).

Require maintainer approval of each public release under P11; neither contributor reputation nor a passing render may grant publication. Enforce draft/public isolation in every server query, search feed and cache, and invalidate all representations on withdrawal. A full app does not solve the immutable-asset takedown gap (`docs/DECISIONS.md`, P11; `pipeline/upload.py`; `docs/TYPESETTING.md`, “Release sequence”).

### 4. URLs and SEO

Port old routes, anchors, aliases, status codes, canonical tags, metadata and indexing exclusions before switching traffic. Keep public chant hubs and distinct accompaniment/source pages as in A/B. Do not introduce login redirects for existing music or lose no-JavaScript content. The existing route and SEO contracts are the migration checklist (`web/src/pages/`, `web/src/lib/seo.ts`, `web/public/_headers`, `web/public/_redirects`, `docs/SEO.md`).

A database alias resolver avoids a huge `_redirects` file but adds runtime dependence; retain a static map for critical old links. If Pages remains in front, its 2,000/100 limits and Function precedence still apply. Replace file-only discovery tests with route-inventory and rendered-response checks; preserve generated search or build a deliberately scoped replacement (`web/scripts/build-discovery.ts`, `web/scripts/check-links.ts`; [Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/)).

### 5. Reader experience

Keep full HTML music pages, minimal client code for reading, and the existing browser export engines behind framework-neutral interfaces. Port worker loading, selection snapshots, focus return, print, scan/typeset fallback and iPad behaviour; neither SvelteKit nor Next proves them preserved. Quick remains accompaniment-only; Customize's chant and MEI capabilities must survive (`web/src/components/ExportBar.astro`, `web/src/scripts/exportLayout.ts`, `web/src/lib/pdf.ts`, `web/src/workers/`; export decisions D23/D28).

An uncached SSR page can fail when the app, database or authentication middleware fails. Keep public reading outside account middleware and serve approved static snapshots during outages; downloaded PDFs remain usable. Without that separation C makes console reliability worse than the current static reader, even if normal response time is good (`web/astro.config.mjs`, `web/wrangler.toml` establish today's static boundary).

### 6. Cost

At 576, 5,760 and 28,800 pieces, C has the same raw-data and R2 scenarios as B, plus account/email/session costs and potentially more dynamic requests. The illustrative 10,000/100,000/500,000 requests at 20 ms fit the $5 Workers allocation, but account calls must be counted too. D1/Neon limits remain those in the shared table; framework choice does not multiply database capacity. A Node host/container alternative needs a quote; no price is assumed.

Builds need not render every catalogue page, but still bundle the application and run reader/export checks. Ingestion time and proofreading do not fall. Additional monitoring, dependency compatibility and account support are likely larger costs than catalogue storage at these sizes; this is an effort judgement, not a measured bill (`.github/workflows/site.yml`, `web/package.json`, `pipeline/typeset/mei/`).

### 7. Effort and risk

Estimate **16–26 person-weeks total**: common model/ingestion **6–10**; accounts and contributor workspace **L, 3–5**; public reader/admin migration, SEO/export/accessibility parity **L, 5–8**; cutover/failure/restore work **M, 2–3**. These are planning ranges, excluding a full collaborative notation editor. Existing Astro templates and export integrations make this more than changing a router (`web/src/pages/`, `web/src/components/ExportBar.astro`, `web/src/scripts/exportLayout.ts`).

Ship a separate contributor workspace first and leave the reader static. Reverse it by closing new admissions and exporting drafts/history; reverse reader migration by restoring old routing and the snapshot-built site. Keep both readers until URL/export parity is demonstrated. Once new editing features produce data the old importer cannot represent, rollback requires a tested converter, not merely a git revert (`pipeline/catalog.py`, `pipeline/corrections.py` define the old contract).

### 8. Fit

C is justified only if an account-based editing product becomes a substantial goal. It is outside the current brief's platform scope; it must separately demonstrate P8 continuous reading, every P9 control and P12 accessibility, including the new account/admin flows. A contributor application beside A may deliver that goal with much less reader risk than replacing the whole site (`the brief §§1, 4–5`; `docs/DECISIONS.md`, P8/P9/P12).

## What would change the recommendation

These are proposed review thresholds, not observed failures or vendor limits unless labelled. Measure 20 representative releases and a representative second collection before choosing a migration.

| Trigger | Response |
|---|---|
| p95 approved-change-to-public exceeds **15 minutes**, with HTML/search/upload over **10 minutes** after change-based processing and caching | Trial B for the costly route family. If native rendering or review dominates instead, improve ingestion; SSR does not fix it. |
| Projected deployment exceeds **16,000 files** on Free or **80,000** on a 100,000-file allowance | Plan capacity before the hard limit. Compare moving chant/search artifacts, larger static hosting and B; keep the static reader if that is simpler. |
| More than **5 simultaneously active editors**, or more than **2 publish/conflict retries a week for four weeks** | Move catalogue editing to transactional D1/Postgres behind snapshots. This changes the store before public rendering. |
| More than **20 active contributors/week** needing persistent drafts, resumable uploads and self-service status, or a firm requirement for private libraries/cross-device accounts | Build an account workspace; compare Astro/B with a separate SvelteKit/Next app. Choose full C only if a prototype shows shared app state/editor complexity warrants migrating the reader too. |
| p95 native-job wait exceeds **30 minutes**, or arrivals exceed reviewed throughput for **two weeks** | Add bounded processing capacity or reduce admissions; increase review capacity. Framework changes cannot clear a rights/proofreading backlog. |
| Rights require access-controlled delivery or licence checks on every asset request | Add a gated asset service and revisit the public-static assumption for those works; do not distribute immutable public URLs first. |
| Prototype cannot serve last-approved reading pages during a simulated **30-minute database outage**, or adds over **500 ms p95** to uncached reading-page response | Reject that SSR cutover or retain static reading snapshots. These are acceptance budgets to test on the intended regions/devices. |

The known file-count scenarios are a genuine qualification to “static forever”; the unverified CI estimate is not a reason to switch today. Accounts and catalogue storage can evolve independently of public rendering. Existing build-time routes and separate editorial Functions already demonstrate that separation (`web/astro.config.mjs`, `web/functions/`, `web/wrangler.toml`).

## Recommendation and phased plan

Adopt **A now, selected parts of B later**. Resolve identities, release ownership and rights before exposing general submissions. A different framework is not the first import dependency; NOH-specific schemas and processing are (`pipeline/parts.py`, `segment.py`, `data/schema/corrections.json`, `web/src/lib/catalog.ts`).

1. **Record the decision and baseline (S, within phase-one estimate).** Confirm Q1/Q2 scope, approval and takedown policy; capture current CI stage timings, traffic, storage, file count and a restore plan. Existing four-minute CI text is an estimate (`docs/OPERATIONS.md:323`).
2. **Prove the model privately (M, 2–3 weeks).** Use roughly 20–50 reviewed items: two accompaniments of one chant, a hymn text with two tunes, a repeated setting across editions, and unaccompanied chant. Produce NOH-equivalent snapshots through aliases and test inline mixed-source selection and both exports. Preserve P2/P8/P9/P12 (`docs/DECISIONS.md`). Roll back by disabling the sample projection.
3. **Build admitted intake and processing (L, 3–5 weeks).** Private quarantine, bounded native jobs, rights evidence, review queues and maintainer approval bound to release hashes. Ship scan-based items first; MEI remains separately approved and published (`pipeline/typeset/mei/manifest.py`, `docs/TYPESETTING.md`). Roll back by pausing intake; retain private records.
4. **Release and exercise failure paths (M, 1–2 weeks).** Verify assets before the public snapshot, retain URLs, check reader/export/accessibility, rehearse failed jobs, stale corrections, rights suppression and snapshot restore. Follow existing P11 authority; do not inherit correction auto-merge as new-source approval (`docs/DECISIONS.md`; `.github/workflows/corrections-batch.yml`). Roll back to the previous approved release.
5. **Use the triggers, not a book count.** Add a catalogue database when editing needs it; publish snapshots from it. Add selective SSR when measured output/build costs warrant it. Consider C for an approved account/editor product, preferably beside the reader first. Each step must keep an exportable catalogue and a tested static fallback.

## Proposed decision row and Q1/Q2

Append this row only; it does not itself decide Q1, Q2 or Q7:

| ID | Source | Proposal | Status |
|---|---|---|---|
| Q7 | [platform options](2026-10-23-platform-options.md) | Keep the public reader static while adding source-independent catalogue snapshots, private submission and native ingestion jobs, rights review and maintainer-approved publication; revisit database-backed rendering or a full app at measured thresholds. | Proposed. Promote Q1 and Q2 together only when the maintainer accepts this direction, with Q2 validated by a representative second-source pilot. |

**Recommend promoting both principles with the eventual decision, not silently in this report.** Q1 should mean static reading by default with explicit review triggers, not a ban on databases/accounts. Q2 should authorize stable identities, reviewed relationships and an adapter pilot before a second book goes public, not a wholesale schema migration or incipit-based merging. A without Q2 perpetuates demonstrated NOH assumptions; Q2 does not require B or C. The exact schema, routes and broader import remain subject to pilot review (`docs/DECISIONS.md`, Q1/Q2; `data/schema/corrections.json`; `web/src/lib/catalog.ts`).

## Sources and verification limits

Repository paths are cited beside claims. Principal inputs: `AGENTS.md`; `docs/ARCHITECTURE.md`; `docs/OPERATIONS.md`; `docs/TYPESETTING.md`; `docs/DECISIONS.md`; `docs/GLOSSARY.md`; `docs/SEO.md`; `docs/EDITING.md`; the two 2026-10-19 reports; `data/LICENSES.md`; and the external-worktree brief cited above. Code checked includes `pipeline/{cli,catalog,parts,segment,corrections,publish,upload,volumes,index}.py`, `pipeline/indexextract/`, `pipeline/typeset/mei/`, `data/volumes.yml`, `data/schema/corrections.json`, Astro routes/catalogue/admin/Functions/configuration, Worker migrations 0001–0008 and intake, and `.github/workflows/*.yml`.

External primary documents, all checked **2026-10-22**, are linked beside their uses: Cloudflare Pages limits/redirects, Workers pricing/Python/Astro/SvelteKit/Next guides, D1 pricing/limits, R2 pricing, Astro on-demand rendering, Neon pricing and GitHub Actions billing. They establish published capabilities and prices, not this account's entitlements. Recheck prices and adapter compatibility before implementation.

Unverified: current production page count; fresh full-build and CI stage/p95 timings; 10×/50× benchmarks; live R2 bytes/operations, traffic/cache ratios and billing plans; actual contributor concurrency/review capacity; rights for any proposed new collection; and behaviour of a prospective Astro/SvelteKit/Next deployment. Historical logs were inspected, but no live-service/account measurements or native-processing benchmark was run. The brief is uncommitted and may change after this reading. Effort ranges, storage/traffic scenarios and trigger values are proposals, not measured facts.
