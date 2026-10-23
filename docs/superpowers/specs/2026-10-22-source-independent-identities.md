# Phase 1: source-independent identities

Status: Draft, revised after review (2026-10-22)

Date: 2026-10-22. Scope: about 2–3 weeks with parallel cards, before a second collection.

## Review changes

Applied the [merged fixes](../reviews/2026-10-22-identities/merged-fixes.md).

- D1: Defer canonical correction input and handles; keep read-only legacy resolution.
- D2: Keep thin representation records; reserve assignments and narrow the refactors.
- D3: Use measured build parity and conditional PDF checks, without raster comparison.
- E1: Allocate only after replay; use ledger locators as the old inventory.
- E2: Bind ledger entries to legacy section locators; require rebinds for structural changes.
- E3: Use UUIDv5 only at bootstrap; the ledger then owns identity.
- E4: Merge the sorted ledger by union and check; hash only source files in the report.
- E5: Deliver M's parser/schema first and give every edited file one card owner.
- E6: Specify public build defaults and pin the initial fixture to baseline data.
- E7: Refresh after lapsed reviews; capture stale-MEI and address baselines first.
- C1: Require a numbered-hymnal dry run without PDF pages or system refs.
- C2: Resize cards and defer LilyPond/MEI records if M passes five days.
- C3: Reserve reviewed work equality and add setting/edition rights fields.
- C4: Require pilot item selection before a second-source import, not the dry run.
- C5: Describe the guard as a tripwire and move PR #155 provenance to §15.
- K1: Record PR #158's guard as built and card G as done.
- K2: Check headers, redirects and Wrangler's generated Function routing.
- K3: Check every writer after its final output and stage identity sidecars explicitly.
- K4: Compare scan, typeset and MEI upload plans without uploading.
- K5: Reject graph and address-registry content in dist and browser bundles.
- K6: Retain release IDs, alias digest and parity evidence for rollback.
- U1: Compare all source labels, borrowed captions and addendum page labels.
- U2: Record one-to-many page identities and the limits of fragment redirects.
- U3: Read print CSS diffs and test visible dates and credits for parity.
- U4: Map future collection, book, edition, provenance and citation fields.

## 1. Decision and result

Add stable identities behind the existing catalogue. An organist sees the same
pages and exports. An editor can keep using every existing correction target.
An importer can identify a work, its accompaniment and its printed source
without treating a NOH slug as the identity of the music.

This implements [P14–P16](../../DECISIONS.md#decided): keep Astro static,
introduce source-independent identities, and follow platform option A.

The [platform report](../../reports/2026-10-23-platform-options.md), Option A,
and [content-model report](../../reports/2026-10-19-multiple-sources-and-language-direction.md)
supply the scope and work/setting/edition distinction. P2–P5 and P8/P9 still apply.
The unapproved brief (`git show claude/redesign-brief-5bd60c:docs/redesign/brief.md`,
§5) informs inline settings and additive URLs only. No redesign, new routes,
second book, accounts, ingestion or publication is approved here.

### Required outcome

- Stable mappings for every NOH item/address; identical inputs give identical output.
- Legacy corrections replay with targets, `was`, provenance and review evidence intact.
- `catalog.json` stays schema 3, with unchanged IDs, slugs, ordering and bytes.
- Existing sources remain authoritative; the graph is derived, not a second catalogue.
- No R2 key, LilyPond source, MEI record, approval or published asset changes.
- No new route, canonical, anchor, search document or export choice.
- Matched builds and the complete old-address test prove parity.
- Built guard #158 warns at 15,000 uploadable files and fails at 19,000.

## 2. Checked baseline

Repository baseline: `a4c520840f0b03cf3dda1e65aef938759847eaab`, the checkout's
`origin/main` when this spec was written. Refresh the baseline at integration;
never compare against a moving branch name without recording its commit.

| Fact | Evidence |
|---|---|
| 576 pieces; seven volumes: `noh1`–`noh5`, `noh7`, `noh8` | `data/catalog.json`, schema 3; `data/volumes.yml` |
| Pipeline ID includes the volume; routes and corrections use the slug | `pipeline/catalog.py` builds `noh1-dominica-i-adventus`; `pipeline/corrections.py::_pieces` indexes `dominica-i-adventus`; `web/src/lib/catalog.ts::Piece` carries both |
| Global slug uniqueness is already enforced | `pipeline/catalog.py::merge_catalog`; do not weaken it for the legacy view |
| A Proper is a container, not one chant | `dominica-i-adventus` has five sections; its Introit is `Ad te levavi`, GregoBase 132 |
| Section identity includes key/number/variant | `pipeline/sections.py::suffix`, `target`; e.g. `part:sabbato-temporum-adventus/gradual:2` |
| Kyriale movement and section precedence matters | `ordinarium-missae-ix` has reviewed `other:gloria` and `other:ite`; the Gloria starts at `noh5/0100/000`, overriding the detected movement |
| Two numbered addenda are not ordinary NOH3 pages | `b-mariae-virginis-reginae`, pagination `regina`, pp. 3–11; `s-pii-x-papae-et-confessoris`, pagination `pius-x`, also pp. 3–11 |
| Reviewed hymn associations do not assert tune equality | `data/vespers/hymns-noh7.yml`; `varia-crudelis-herodes` and `varia-crudelis-herodes-alter-tonus` have distinct pairings, 2129 and 1825 |
| OF reuses existing music | `ordinary-form-propers.json`: `annunciation` Introit lends `dominica-iv-adventus/introit`, ref `noh1/0064/002`, chant 79 |
| Vespers targets identify editorial assignments | `vespers:adv1/antiphon-1`: chant 2835, refs `noh8/0077/000` and `noh8/0077/001`; repeated singing is not another printed item |
| Historical correction evidence must survive | `c-0001` changes `piece:ordinarium-missae-asperges` mode from null to VII; `c-0002` pairs its chant with 497 |
| Two explicit redirect rules exist | `web/public/_redirects`: `/piece/noh1-p156/` and `/admin/parts/` |
| Kyriale redirects are a different mechanism | `piece/[slug].astro` calls `Astro.redirect`; local output for `/piece/ordinarium-missae-ix/` is refresh HTML pointing to `/kyriale/ix/` |

There is no `web/dist` in this worktree. The existing main-checkout build at
`/Users/npadley/development/nova-organi-harmonia-online/web/dist` has 5,018 files,
1,744 HTML files and `sitemap.xml`, matching the report's local counts.
It is an address-inventory input, not evidence of a fresh build or production.
No pipeline regeneration, live D1 query, R2 check or build was run for this spec.

## 3. What Phase 1 materialises

Materialise sources/editions, items, provisional works, settings, thin
representations and aliases for identity and round-trip compatibility.

| Concept | Materialise now | Reserve for the pilot or later |
|---|---|---|
| Work | One provisional identity for each identified printed musical unit; no title-based deduplication | Reviewed equality across sources, separate text and tune graphs, variant families |
| Source | NOH collection metadata and seven edition-volume records | Admission, rights evidence workflow, contributors and other collections |
| Source item | Each legacy Piece as a printed container or standalone item; child items for identified sections/movements and reviewed Vespers music | Arbitrary movement hierarchies and new import adapters |
| Setting/accompaniment | One per independent printed musical unit; scans and transcriptions attach to it | Two accompaniments of one work and a repeated setting across editions |
| Representation | Existing scan ranges and thin references to LilyPond files, MEI records and manifests | New renderers, conversions and redistribution permissions |
| Assignment | None | EF/OF/Vespers links with a per-part slot; no new calendar engine |
| Alias | Old IDs, slugs, targets, routes and fragments mapped explicitly | New public work/source routes and redirects for actual future moves |

A work is the musical/textual unit to which settings belong, not a date, book
or page. These identities are provisional. External IDs such as GregoBase 132
are evidence-bearing references, never primary keys or instructions to merge.

Rubrics get source items, not invented works. Undivided compounds remain
`classification: unresolved`, with container scans for reading/export. Coverage
includes unresolved items; never guess musical divisions to reach 100%.

Known borrowing points to the lender's item/setting. It does not mint another
accompaniment. Explicit repeated use of the same printed item may share its
setting. Separate printings remain separate provisional works/settings unless
an already reviewed relationship establishes the exact same printed object.
Neither matching incipits nor matching GregoBase IDs merges works (P15).
A setting's null rights reference means unknown, never a licence. It hides no
existing NOH credit. Phase 1 grants no new publication or export permission.

## 4. Files and schema

All new JSON uses `schema_version: 1`. IDs are strings of the typed forms in §5.
Arrays keep musical/printed order where order has meaning; unordered collections
sort by ID. Missing knowledge is null, not an invented author, date or licence.
Schema validation rejects unknown fields and dangling references.

### Source and generated files

| Path | Ownership and purpose |
|---|---|
| `data/identities/sources.yml` | New reviewed source: collection/edition metadata, display labels and adapter policy; editable by hand |
| `data/identities/ledger.json` | New command-managed source: permanent IDs, birth seeds, legacy locators and tombstones; never regenerated |
| `data/identities/aliases.yml` | New reviewed source: exceptional identity aliases and their evidence; editable by hand; existing HTTP rules are read from `_redirects` |
| `data/identities/legacy-addresses.json` | Command-captured, reviewed baseline source: routes/fragments from old dist and sitemap, capture hashes and origins |
| `data/identities/snapshot.json` | Generated graph: works, items, settings, thin representations and relationship evidence |
| `data/identities/aliases.json` | Generated lookup tables for IDs, targets and addresses; not a public endpoint |
| `data/identities/migration.json` | Generated source-file hashes, entity/reference counts and unresolved references; no timestamps |
| `data/schema/identities.json` | Schema for the source and output records; tests validate both |

I updates AGENTS.md's ownership lists and OPERATIONS' regeneration order.
Existing index/section/Vespers/OF/hymn YAML stays authoritative; no mass ID
rewrite or hand edit to generated files.

### Sources and editions (`sources.yml`)

Top level: `schema_version: int`, `sources: Source[]`, `editions: Edition[]`.
An edition is an addressable published source unit; it need not be a volume.
NOH uses seven volume records. For a future source identity block: collection
maps to Source; book maps to Edition; edition details map to Edition's title and
publication note; provenance maps to Edition's provenance reference and
SourceItem.origin; citation combines Edition.citation_label and SourceItem.locator.
A later edition group can add a separate edition tier without renaming IDs.

| Record | Required fields and types |
|---|---|
| Source | `id: src_ID`, `title: string`, `short_title: string`, `licence_reference: string\|null` |
| Edition | `id: edn_ID`, `source_id: src_ID`, `legacy_volume: string\|null`, `title: string`, `part: string\|null`, `citation_label: string`, `short_label: string`, `sort_order: int`, `adapter: string`, `scan_registry_key: string\|null` |
| Edition, continued | `publication_note: string\|null`, `provenance_reference: string\|null`, `rights_reference: string\|null`, `rights_state: unknown\|cleared\|withdrawn`, `policy: EditionPolicy` |
| EditionPolicy | `show_related_hymns: bool`, `borrow_whole_reference: bool`, `related_hymns_heading: string\|null`, `reference_group: string\|null` |

For NOH1, `citation_label` is exactly `Nova Organi Harmonia, part I`.
`scan_registry_key: noh1` points to `volumes.yml`, retaining its PDF checksum,
page-map configuration and allowlist. Do not copy those into a second authority.
NOH3's addenda remain pagination segments of its edition; retain `regina` and
`pius-x`, their labels and dates. New metadata must not date all bound material
to 1942; visible dates and credits, including “1942”, remain unchanged.
NOH editions use `rights_state: cleared` with `data/LICENSES.md` as evidence
for the registered public-domain scans. This does not clear third-party chant
or contributed settings; their existing restrictions still apply.

Policy moves existing branching out of shared readers: NOH8 shows related hymns;
NOH7 does not substitute a whole cited litany for an antiphon. Exact current
headings live in policy, including “Related hymn settings in Book VII”. This is
compatibility policy, not evidence that other sources must follow NOH's rules.

### Graph (`snapshot.json`)

Top level: `schema_version`, `sources`, `editions`, `works`, `source_items`,
`settings`, `representations`, `relations`. The first two are validated
projections of `sources.yml`. IDs and associations come from the ledger;
descriptive values come from current inputs. Generate no assignments.

| Record | Required fields and types |
|---|---|
| Work | `id: wrk_ID`, `title: string\|null`, `language: string\|null`, `kind: string`, `identity_status: provisional`, `external_refs: ExternalRef[]` |
| SourceItem | `id: itm_ID`, `edition_id: edn_ID`, `parent_id: itm_ID\|null`, `classification: container\|musical-unit\|reference\|unresolved`, `title: string\|null`, `locator: Locator`, `setting_ids: set_ID[]`, `origin: Origin` |
| Locator | `pagination: string\|null`, `printed_pages: [int,int]\|null`, optional `pdf_pages: [int,int]\|null` and `system_refs: string[]`, `item_number: string\|null` |
| Setting | `id: set_ID`, `work_id: wrk_ID`, `kind: organ-accompaniment\|unaccompanied\|unspecified`, `source_item_ids: itm_ID[]`, `attribution: string\|null`, `rights_reference: string\|null`, `identity_status: provisional` |
| Representation | `id: rep_ID`, `kind: scan\|lilypond\|mei`, `setting_id: set_ID\|null`, `source_item_ids: itm_ID[]`, `locator: RepresentationLocator`, `evidence: Origin[]` |
| Assignment (reserved; none generated) | `id: asg_ID`, `calendar: ef1962\|of1970\|vespers1960`, `key: string`, `slot: string`, `variant: string`, `years: string[]`, `seasons: string[]`, `source_item_ids: itm_ID[]`, `setting_ids: set_ID[]`, `origin: Origin` |
| Relation | `from_id: ID`, `to_id: ID`, `kind: borrows\|related-hymn\|candidate-same-work\|same-work`, `status: string`, `evidence: Origin[]` |
| ExternalRef | `authority: string`, `value: string`, `status: string`, `evidence: Origin[]` |
| Origin | `path: string`, `selector: string`, `legacy_target: string\|null` |

`Origin.selector` is a documented JSON Pointer for JSON or the same pointer over
parsed YAML. It is evidence/location, not identity. Arrays of origins preserve
all evidence, including uncertainty and source-review notes.

`RepresentationLocator` is a tagged union by representation kind:

- Scan: `system_refs: string[]`, `asset_stems: string[]`,
  `aspects: [number,number][]`; preserve each legacy array's order and alignment.
- LilyPond: `source_path: string`, `legacy_target: string|null`,
  `render_hash: string|null`, `manifest_pointer: string|null`.
- MEI: `record_path: string`, `legacy_target: string|null`,
  `render_hash: string|null`, `artifact_sha256: string|null`,
  `manifest_pointer: string|null`. Existing record and manifest own all inputs,
  approval and boundary data; reference them instead of copying or changing them.

A representation ID identifies a stable representation slot, not its bytes.
Asset hashes still identify immutable revisions. These are thin references:
read publication and review state from existing records/manifests, not a copied
Capabilities block. Unmatched LilyPond sources and failed/revoked/unpublished
MEI records retain null setting links where appropriate; invent no match.
An approved record alone never enables reflow: the published MEI manifest must
name the same legacy target and render hash. Existing fallback rules still govern.

Generate only `borrows` (OF lenders and NOH7 borrowing) and `related-hymn`
relations. External chant references stay on `ExternalRef`. Reserve
`candidate-same-work` and `same-work` for the pilot, with required status and
nonempty evidence; generate neither. They never merge works automatically.

Assignments are reserved, with no `asg_` allocation or generated array.
Their future `slot` is the part key for EF/OF/Vespers: for EF, `introit`,
`gradual`, etc. match the child target; OF uses its existing slot; Vespers uses
keys such as `antiphon-1`. This anchors one chosen setting per part while
allowing several `setting_ids`. Future projection must retain EF `days` versus
`linked_days`, OF variants/cycles/seasons/missing lenders, and Vespers offices,
I/II, repeats and tone-bank provenance. Existing calendars remain authoritative.

### Worked example

`noh1-dominica-i-adventus` (printed pp. 3–7, PDF pp. 29–33) becomes a
container. Its Introit, `part:dominica-i-adventus/introit`, gets an item, work,
setting and scan representation. Bootstrap produces
`itm_614a61a9-f6a0-50aa-9d7d-6e4d02d6e7b8` for that child; these IDs are not
in today's data. Its title is “Ad te levavi”, with GregoBase 132 as a reference,
not proof of equality. Eight systems run from `noh1/0029/000` to, excluding,
the Gradual at `noh1/0030/004`. The first stem stays
`systems/noh1/0029/000-3160d54d7980`; `/piece/dominica-i-adventus/` stays put.

Missa IX's `movement:ordinarium-missae-ix/kyrie` links to
`data/typeset/src/vol-5/missa-ix/kyrie_IX.ly` and
`data/typeset/mei/records/kyrie_IX.json`. Attach IDs only in the sidecar;
compare the entire existing record, including hashes and approval digest.

## 5. IDs and the permanent ledger

IDs are opaque UUIDs with type prefixes: `src_`, `edn_`, `itm_`, `wrk_`,
`set_`, `rep_`. Reserve `asg_` and `tgt_` for the pilot; allocate neither now.
Titles, slugs, page numbers and content hashes are not identities. Consumers
must not decode an ID or construct one themselves.

For deterministic `bootstrap` only, use UUIDv5:

```python
namespace = uuid.uuid5(uuid.NAMESPACE_URL, 'https://cantusorgani.org/identity/v1')
# namespace = 5e3764f4-b31d-566d-84f8-c267bc47eebc
ident = prefix + '_' + str(uuid.uuid5(namespace, prefix + '\0' + birth_seed))
```

After bootstrap, the ledger is the sole authority. `allocate` uses UUIDv4 once
for each new entry and persists it; builds never remint from seeds. A birth seed
records the original import key. A source, title or location change retains IDs.

| Allocation | Birth seed |
|---|---|
| NOH source / edition | `noh` / `noh1` (and each registered volume key) |
| Top-level item | `piece:<legacy full id>`, e.g. `piece:noh1-dominica-i-adventus` |
| Child item, work, setting | Exact effective legacy part/movement target; standalone work/setting uses `piece:<slug>` |
| Reviewed Vespers child | `vespers-source:<reviewed file>:<stable source selector>` |
| Scan representation | `scan:<item birth seed>`; the example uses `scan:part:dominica-i-adventus/introit` |
| LilyPond representation | `lilypond:<source path relative to data/typeset/src>` |
| MEI representation | `mei:<record path relative to data/typeset/mei/records>` |

Ledger top level: `schema_version`, `namespace`, `entries: LedgerEntry[]`.
Each entry has `id`, `kind`, `birth_seed`, `state: active|retired`,
`legacy_keys: string[]`, `links: {role: string, id: ID}[]`, and a nullable
`locator: {slug, kind, key|null, n|null, variant|null}` in legacy spelling.
Non-section entries may have a null locator and use their recorded legacy keys.
Section entries also retain their bound `row_ordinal: int`; it is a structural guard,
not identity. JSON Pointers belong only in generated Origin evidence.

The ledger is append-only in allocations and change history: never delete an
entry or tombstone. Sort entries by ID, one compact JSON entry per line inside
the JSON envelope. Only `rebind` changes a bound locator/ordinal; it appends
old/new values and a reason to `changes`. Retirement also retains its history.

`noh identities bootstrap --adapter noh` refuses a nonempty ledger. Two empty
scratch-directory runs must match. Later `allocate --adapter noh` proposes
missing entries after replay and writes them only after validation. Read-only
build/check jobs never allocate. Duplicate seeds, collisions, ambiguous selectors
or incompatible owners fail with both origins; never guess or silently suffix.

Allocation is a post-replay step. `correct`/`correct-batch` change the overlay;
`apply-corrections` replays it and writes the existing derived outputs. None
writes the ledger or reads the snapshot during replay, including `_outputs`.
After replay finishes, the command orchestrator calls `identities allocate`
against the effective catalogue, then build/check. Source writes by correction
commands remain limited to the overlay; the separate allocator owns the ledger.

The “old” section inventory is the ledger's per-entry legacy locator and bound
ordinal, not git history or a snapshot pointer. Check fails if any active legacy
key resolves to a different bound row or to none. Insert/delete/reorder/key changes
require reviewed allocations or `noh identities rebind --id <ID> --to <locator>
--reason <text>`; an `n`→`key` change is a rebind. Title, chant, page and start
corrections alone retain IDs. Never let `gradual:2` silently change musical unit.

Keep old spellings as historical aliases with evidence; do not keep a conflicting
old spelling active. If legacy positional replay would now address another row,
block publication until an explicit compatibility choice is reviewed. Existing
admin list editing still works for unambiguous new keyed rows: replay first,
allocate afterwards, include overlay, ledger and sidecars in the same PR.
Ambiguous renumbering stays on hold. There is no automatic split/join command.

Merge concurrent ledgers by union of allocations and change histories. Take
main's generated sidecars, regenerate after the union, then run `identities check`.
Conflicting changes to the same ID or legacy key require review; never choose
one silently. Card I documents this exception in OPERATIONS' merging section;
“take main and regenerate” cannot recover permanent ledger allocations.

## 6. Deterministic migration

### Direction of data flow

```text
NOH scans/indexes -> catalog.base.json
base + reviewed sections + corrections -> catalog.json (existing compatibility view)
reviewed Vespers / OF / hymn / typeset inputs -> their existing derived files
those files + ledger + source metadata -> identity snapshot and alias indexes
existing compatibility files + small identity lookups -> unchanged Astro reader
```

The graph follows overlay replay, beside `catalog.json`. A lossless
`legacy_catalog()` boundary returns existing schema-3 records; do not reconstruct
them from the graph. No new IDs enter `Piece.id` or PDF payloads.

Replay never consults the ledger or snapshot. The read-only target resolver
loads the ledger and generated target projection independently of snapshot data;
it is used by diagnostics and tests, not correction ingress.

### Import rules

1. Capture byte hashes of all inputs and protected outputs in a scratch baseline.
   Include base/catalogue, correction history, reviewed lists, chant sources,
   published scan manifests, typeset files/records/manifests and calendar windows.
2. Allocate source/edition and top-level item IDs for all 576 records, including
   references, entries without systems and entries awaiting review.
3. Enumerate effective printed units using `sections.target`, reviewed-section
   precedence and `typeset.match.targets`. Cross-check against the site's
   `movementStarts`/`jumpTargets`. Do not mint a second Gloria for a suppressed
   detected movement. Preserve repeat/variant distinctions and order-only status.
4. Add reviewed Vespers units from their source records. Repeated dated uses and
   tone-bank borrowing point to those records. Preserve noncontiguous ref lists,
   overlapping systems and note-only items; never partition music by guesswork.
5. Attach settings, representations and known lender relationships. Standalone
   musical pieces receive one unit; unclassified compounds retain container
   scans. Embedded hymns are resolved by their reviewed refs, not title equality.
6. Resolve existing targets and the two supported relation kinds through the
   ledger. Retain calendar values as evidence; generate no assignment entities.
7. Generate aliases and the migration report. Check completeness, uniqueness,
   no change in publication eligibility and byte equality of protected outputs.

| Input/reference family | Required treatment |
|---|---|
| `corrections.yml`, `corrections-log.json`, `reviewed.json`, review queue | Map every target kind and historical entry; preserve correction IDs, order, `was`, dates, sources, notes, batch and review fingerprints |
| `sections/*.yml` and section-list corrections | Map whole-list and part targets separately; preserve keys, numbered variants, borrowed pages, rubrics and translations |
| `index-*.yml`, rubrics and catalogue references | Keep printed containers, `reference_sources`, omissions, linked days, pagination and unresolved citations |
| `vespers/*.yml` and lineup | Map office/antiphon/Magnificat targets, refs, opening-only music, psalm/tone banks, Marian items, notes, hymn links and I/II date uses |
| `ordinary-form/*.yml`, propers and coverage | Preserve reviewed assignments and baseline; resolve lender slug + part + variant + ref to exact item/setting; missing lender remains missing |
| `typeset/parts.yml`, manifest and review | Map matches and candidates including `none`/`other-setting`; preserve all statuses, evidence and targets; no matcher rerun just to allocate IDs |
| `typeset/mei/records/*.json`, manifest | Reference every record, including nonapproved records; preserve target, path, inputs, review, render hash and asset digest exactly |
| `hymn-pairings.yml`, `hymn-pairings.json`, `vespers/hymns-noh7.yml` | Keep evidence and unresolved/copyrighted/link-only states; associations remain relations, never work merges |
| `chants.json`, Good Friday and external chant sources | Keep existing chant IDs/payloads; external-only music remains external, not a fabricated NOH source item |

If an old target is genuinely gone, record a retired alias with its reason and
evidence; never silently discard it. Active corrections, manifest entries and
published addresses must resolve. Existing historical review entries that are
already lapsed stay lapsed; an explicit report distinguishes these from migration
failures. No unexplained unresolved active reference is acceptable.

### Replay and serialization

Add `noh identities build [--out <directory>]` and `noh identities check`.
`build` reads existing inputs, writes only its three generated JSON files and
fails on unallocated records. `check` writes nothing: recompute in memory, compare
bytes, verify all edges, ledger invariants and protected-file hashes.

Generated JSON serialization: UTF-8, LF, two-space indent, sorted object keys,
`ensure_ascii=False`, no NaN, one trailing newline. Sort unordered records by ID;
retain arrays for music, sources, corrections and priorities in source order.
No wall clock, absolute path, machine locale, random sample or filesystem order.
Do not impose this new serialization on existing generated files.

The report records `adapter_version`, `input_sha256` by relative path,
entity counts, alias counts and unresolved entries with reasons. Hash source
files only: no catalogues, manifests, other generated files or self-hash. Include
code versions used by the adapter. Put any run timings in CI artifacts, not tracked JSON.

`tools/check_identity_migration.py` replays twice into independent temporary
directories, with different hash seeds/locales and identical pinned inputs.
It compares bytes and source-file hashes, verifies a second run changes nothing,
and checks historical target/field resolution against current legacy replay.
It must also perform bootstrap twice on the pinned initial fixture, then verify
the checked-in ledger keeps every allocated ID across normal subsequent edits.
“Pinned initial fixture” means `data/` at the recorded baseline commit.

### Writer/check matrix

Use one post-write orchestration helper, outside replay. Allocation is explicit
for approved new records; build/check never invents IDs. In read-only checks,
missing allocations fail. Refresh means allocate when authorized, build, check.

| Writer | Refresh/check point |
|---|---|
| `scripts/regenerate.sh` | After its last write, step 8 `corrections --lapsed`; keep both overlay passes and conditional Vespers rebuild |
| `correct`, `correct-batch`, `apply-corrections`, `catalog`, `vespers-lineup` | After each command's final legacy output, via the outer orchestrator |
| OF, hymn, typeset manifest/review and direct MEI record/manifest updates | Refresh after their final output; CI checks these inputs even without catalogue changes |
| `corrections-batch.yml` | After typeset manifest **and** OF regeneration; stage ledger and all three generated sidecars explicitly with the existing file list |
| `catalog-rebuild.yml`, `publish.yml` | After OF generation and before committing; include all identity changes |
| `mei-conversion.yml`, `typeset-preview.yml` | Exempt: artifact-only workflows, no committed catalogue/identity writes; retain renderer/uploader permission separation |
| CI | Check freshness after corrections/OF checks, including MEI record/manifest paths |

No dependency-cache key change is needed. Any cached parity output must key on
both commits, identity inputs, public configuration and any measured clock freeze.

## 7. Corrections, admin and D1

Phase 1 keeps legacy correction input and storage. No `target:tgt_…` input,
canonical handle allocation, Worker change, admin ingress normalization or D1
migration. Only source-neutral ref validation and the range parser change (§9).
Replay keeps existing targets, `was`, review fingerprints and duplicate rules.

`noh identities resolve <legacy target>` is read-only and returns
`{kind, entity_id, legacy_target, state}` from the generated target table.
Kinds retain their correction facet: `part:...` and `pairing:...` may share an
item but are not interchangeable. Unknown, ambiguous or retired active requests
fail with evidence. `noh where --ids` adds graph IDs and legacy targets; normal
`where` output stays unchanged. Replay tests compare this lookup to legacy
resolution; replay itself does not depend on it.

### Deferred: canonical input

The pilot must decide whether editors need `target:tgt_…`. If added, normalize
before validation, `was`, dedupe, fingerprints and persistence at every boundary:
CLI/batch, report/edit forms, API, typeset-match `corrections.proposed`, review,
skip/unskip and audit details. Check target/`pieceId` agreement **before** the
Worker discards explicit piece targets in favour of NULL. Preserve issue `seen`,
legacy draft/snapshot `file`, preview hashes and numeric resolution/batch links.
Migrations 0004/0006 dedupe legacy targets and issue hashes; 0007's snapshot
trigger expects `typeset:<file>`. Endpoint and mixed-version tests must cover all
of these. Do not rewrite stored history or add a schema migration by assumption.

That pilot must define alias distribution and Worker/Pages deployment order
before enabling canonical clients. Unknown aliases must fail, not enter storage.
No page, sitemap, `llms.txt` or Report link emits a `tgt_` URL; correction forms
stay noindex with query-free canonicals. None of this is a Phase 1 build card.

## 8. Alias and address registry

Identity aliases and HTTP redirects are different. Most aliases never reach
`_redirects`: an unchanged URL needs a mapping, not a redirect to itself.
Phase 1 adds **zero redirect rules** and keeps both existing rules unchanged.

Generated `aliases.json` has:

| Table | Key and value |
|---|---|
| `legacy_ids` | Full `<volume>-<slug>` -> top-level item ID |
| `legacy_slugs` | Exact slug -> top-level item ID; globally unique for NOH |
| `targets` | Legacy target -> `{kind, entity_id, legacy_target, state}`; no handles |
| `addresses` | `{path, fragment\|null}` -> `{destination_path, destination_fragment\|null, mechanism, entity_ids}` |
| `redirects` | Ordered `{from, to, status}` for existing `_redirects` rules only |

`mechanism` is `identity`, `pages-rule` or `astro-refresh`; keep the existing
mechanism. Address rows may have empty `entity_ids` for utilities or navigation.
One `/piece/<slug>/` container can map to several works; `entity_ids` records
those works and the container item for a future IA. Each child anchor, such as
`#introit` or `#gradual-2`, also maps to its child `itm_` ID. Phase 1 chooses no
future public slug. A later move needs stable anchors or client-side fragment
handling: a server cannot redirect on a fragment. Slugs never define identity.
Import HTTP rules from `web/public/_redirects`; do not create a second editable
copy. Identity generation checks that the address registry agrees with them.
Query strings are state, not identity. Preserve query behaviour and never put
queries/fragments into canonicals. Registry validation rejects loops, duplicate
keys with different destinations and missing destinations.

Capture `legacy-addresses.json` from the union of the supplied current dist and
a fresh pinned-main build. Record each origin's file hashes and optional commit;
do not pretend the old local build has known commit provenance. Include:

- Every HTML route, even noindex pages and refresh redirects omitted by sitemap.
- Every sitemap URL, every HTML `id` and named anchor, and every internal href
  with a fragment or query. Decode HTML entities and URL escapes once.
- Existing `_redirects` source and destination paths; public JSON/resource paths.
- Explicit bookmarked query contracts: day `date`, OF cycle/season and transfer
  parameters, correction targets/`seen`, and legacy `piece`/`field` links.

Include day, piece, Kyriale, OF and dated Vespers routes, especially
`/vespers/<date>/i/`, and About anchors; do not limit capture to navigation links.

`tools/check_legacy_addresses.py` resolves every captured address against the
candidate dist: apply the existing Pages rule, follow refresh HTML, then require
the final file and fragment. Preserve fragments across redirects that do not
replace them; a source fragment cannot be implemented by a server redirect.
Limit chains and fail loops. Canonical destination and noindex policy must agree
with the baseline. Unknown-path fixtures must still resolve to an HTTP 404 in
Playwright, not a successful home-page fallback.

Its capture command is `uv run python -m tools.check_legacy_addresses --capture
--dist <old-dist> --out data/identities/legacy-addresses.json`; subsequent captures
union the inventory, never delete addresses. Verification is
`uv run python -m tools.check_legacy_addresses --inventory
data/identities/legacy-addresses.json --dist web/dist`. In each command above,
join the wrapped lines with spaces.

Do not count an Astro refresh file as a `_redirects` rule, but count it as a
deploy file. Cloudflare allows 2,000 static and 100 dynamic rules, and does not
apply `_redirects` to Function responses. A future move must fit these budgets
or receive a separately reviewed redirect design. About 576 piece rules would
fit below the 1,500 warning for a later whole-piece move; fragment handling is
a separate problem. No Bulk Redirects or alias Function is needed here. See [Cloudflare redirects](https://developers.cloudflare.com/pages/configuration/redirects/).

## 9. Remove shared one-book assumptions

“Remove” means replace shared identity/selection rules, not erase accurate NOH
copy or rewrite scan recognition. Tests use an in-memory non-NOH fixture; it is
never added to production data or routes.

| Seam found in code | Phase 1 action |
|---|---|
| `catalog.py` full ID vs `corrections.py::_pieces` slug vs `catalog.ts::Piece.id` | Name each explicitly as a legacy identifier; resolve through ledger APIs; keep both old values |
| Source labels: `volumeLabel`, `SystemStack.astro` borrowed caption, `LineupStack.astro` fallback, `pagesLabel` | Read edition labels; preserve every NOH string, including part-less and no-source fallbacks; unknown edition fails the build |
| `pipeline/hymnlinks.py`, `catalog.ts::relatedHymnSettings`, `vespers.ts::hymnSettings` filter `noh7` | Validate reviewed links by target existence, genre, systems and source status, not volume; retain current link membership/order |
| `piece/[slug].astro` gates related hymns on `noh8` and borrowing on `noh7` | Read edition policy; preserve the current heading and behaviour |
| `data/schema/corrections.json` requires `noh\d` and `noh8` refs | Accept registered source keys syntactically, validate membership/ownership in a shared resolver; keep NOH tone rules in its adapter |
| `pipeline/sections.py`, `admin/targets.ts`, `admin/scans.ts`, `hymnpairings.ts` repeat NOH ref patterns | Use source-neutral ref parsing and registered-volume validation; test hyphenated volume keys and unknown refs |
| `coerce(system_range)` splits on every hyphen | Parse two complete refs with an anchored grammar; a future volume key may contain hyphens; preserve cross-volume/order rejection |
| `ordinary_form.py::_candidate_rank` parses `volume[3:]` | NOH adapter, unchanged in Phase 1 |
| `pipeline/catalog.py::PART_TO_VOLUME`, `web/src/lib/references.ts` Roman map and NOH4 `ad calcem` | NOH adapter, unchanged in Phase 1 |
| `typeset/match.py::VOLUME`, filename/page/movement hints | NOH adapter, unchanged in Phase 1; thin representations reference its output |
| `vespers/reviewed.py`, `lineup.py` load `hymns-noh7.yml` | NOH adapter, unchanged in Phase 1; preserve filename/history |
| `segment.py`, `parts.py`, index extraction, `vesperitems.py`, volume-specific slicing | NOH adapter, unchanged in Phase 1 |
| `regenerate.sh all`, publish/catalog workflow volume choices | Remain NOH operational allowlists; add identity refresh/check, not arbitrary uploads |
| `ExportBar.astro`, `pdf.ts`, source captions, SEO descriptions and footer | Keep exact NOH presentation/metadata for this corpus; record as presentation debt for the pilot, not generic source authority |
| `indexes.ts` divisions/Kyriale routing and `good-friday.json` external IDs | Preserve current liturgical UI and external references; neither defines a universal work key |

Generic refs remain `<registered-volume>/<four-digit PDF page>/<three-digit
system>`. Allow source keys matching `[a-z][a-z0-9-]{0,63}`; validate an actual
registry member and actual system, not just that regex. Keep old fixed widths
and page bounds in the NOH adapter. Larger/new locator formats await a pilot.
No relaxation of source permissions, correction lengths or typeset path safety.
This scan-ref grammar does not constrain SourceItem locators: a numbered hymnal
may omit both PDF pages and system refs (§13).

Render labels for all 576 pieces, including `regina` and `pius-x`, before and
after; compare volume/page labels, borrowed captions and the LineupStack
fallback. Keep “Nova Organi Harmonia” for `part: null` and absent-source fallback,
and “another volume” for unresolved borrowing. Test unknown editions as build
failures. Compare visible date and credit strings, including “1942”.

## 10. Implementation boundaries

§15 assigns every file one owner: M owns core/catalogue hooks, S shared labels/
refs, I CLI/workflows. No canonical normalization or Worker/admin API edits.
Typeset/MEI sources, rendering settings/includes and export engines are read-only.
Keep sidecars outside the MEI package: `versions.py` hashes `extract.py`,
`listen_full.ily`, `encode.py`, `model.py` and `diagnostics.py`. Preserve legacy
target + render hash joins; no approval carry-forward. Only label/policy
projections may reach pages, never graph, target table or address-registry data.

## 11. Proving reader and export parity

Add `tools/compare_identity_dist.py` with matched-build and existing-dist modes:

```bash
uv run python -m tools.compare_identity_dist --base <base-sha> --head <head-sha> --out /tmp/identity-parity
uv run python -m tools.compare_identity_dist --before /tmp/main-dist --after web/dist --out /tmp/identity-parity
```

Matched builds export tracked trees to `<out>/base` and `<out>/head`; never
replace a working checkout or copy `.env`, `.dev.vars`, secrets or caches.
Record commit IDs, commands, pinned Node/pnpm versions, lockfiles and input
hashes. Install with `pnpm --dir <tree>/web install --frozen-lockfile` and
`uv sync --frozen` in each tree. Use these public defaults from `scripts/check.sh`
for **all** production-build proofs, including guard checks in worktrees:

```bash
export PUBLIC_ASSET_BASE=https://images.cantusorgani.org
export PUBLIC_CORRECTIONS_ENDPOINT=https://api.cantusorgani.org
export PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
unset E2E_TEST_PAGES PUBLIC_MEI_MANIFEST E2E_DIST
uv run noh typeset-mei-stale --json --out build/mei/stale/stale.json > /dev/null
pnpm --dir web build
```

Run that block in each exported tree. Keep the committed Vespers window; generate
and compare each tree's stale-MEI report, never copy one over the other.
First run baseline versus baseline to measure nondeterminism. Freeze build or
browser clocks only for fields that run proves vary; record the instant and test
any child-process clock hook. Do not assume `SOURCE_DATE_EPOCH` controls Node.
No blanket timestamp stripping. Existing-dist mode is a quick comparison, not
acceptance evidence without the matched-build provenance.

### Comparison rules

1. Diff complete relative file lists and bytes: HTML, JSON, sitemap, `_headers`,
   `_redirects`, Pagefind and assets. Compare inline/export JSON values and order.
2. Compare canonicals, metadata/JSON-LD, noindex, robots, all anchors and old-address
   resolution (§8). `_headers` and `_redirects` remain byte-identical; count the
   seven current header rules and fail above the 100-rule limit. Parse whole
   redirect rules, ignoring blanks/comments; reject malformed or conflicting
   duplicates, preserve order and classify dynamic rules from sources only.
3. Capture Wrangler's generated `_routes.json` from local Functions builds on both
   trees; Astro output alone cannot prove routing. No static route may newly
   invoke Functions. Validate at least one include, at most 100 combined rules
   and at most 100 characters per rule. Bundle Functions locally without deploying.
   See [Pages routing](https://developers.cloudflare.com/pages/functions/routing/).
4. List every changed JS/CSS bundle, preload and reference with old/new digest and
   a reviewed explanation. There is no bijective bundle normalizer. Raw HTML byte
   differences must be reported; only individually explained bundle references
   or measured build-only fields may differ. Read the print stylesheet bundle
   diff explicitly. No unexplained HTML, payload or search-result change passes.
5. Fail if graph or address-registry content appears in dist or browser bundles,
   including embedded/minified content, not just matching filenames. Inspect the
   module graph and test leakage with a fixture. No target projection is public
   in Phase 1. Allow only intended build-time label/policy projections.
6. Write `report.json` and `report.md`: each difference, reason, raw digest,
   command duration and total time. Never normalize visible dates/credits,
   correction dates, anchors, asset hashes, MEI inputs or musical geometry.

### Export and reader proof

Keep `exportParts`, selection IDs/targets, ordered parts, system sources/stems,
dimensions, chant IDs, rubrics, manifest joins and fallback availability identical.
The fixture set is a Proper (`dominica-i-adventus`), numbered Graduals
(`sabbato-temporum-adventus`), Kyriale IX, an OF mixed-lender page, dated I/II
Vespers, a standalone hymn and scan-only music. Retain every control in
[must-keep.md](../../ui/must-keep.md). Byte HTML checks cover the notice and skip
links; add a Tab-once “Skip to music” check for piece/Kyriale/OF/Vespers pages
and print-media checks on a Proper and Kyriale IX. Test visible dates and credits
as text, including “1942”; source labels have the full-corpus gate in §9.

Always run existing production browser tests and export e2e suites on **head**.
Export suites need `pnpm --dir web build:e2e` then
`pnpm --dir web test:e2e:export`; production `dist/` is not their fixture build.
The existing config uses port 8799 and `web/e2e/.state` with local D1; run these
suites serially and never reuse another server. For paired production checks,
B's parity test owns separate servers on 8801/8802 and separate local state
under `<out>/base-state` and `<out>/head-state`. Test unknown paths return 404.

Only if export-path JS/CSS bundles differ, build **both** trees' `dist-e2e/`
fixtures (the script sets `E2E_TEST_PAGES=1`, `PUBLIC_MEI_MANIFEST=fixture`,
`PUBLIC_ASSET_BASE=/systems`). Serve them on 8803/8804 with separate state.
Compare Quick/Customize PDFs only for the fixture set above, using identical
pinned assets and `web/scripts/verify-export-pdf.ts`: page count, MediaBoxes,
text, order and layout checks. Cover Quick Letter/A4 and typeset/scan fallback;
Customize MEI/fixed/scans and chant Off/Before/Only. Quick stays accompaniment-only.
Ignore only PDF timestamps/document IDs. No rasterised PDF comparison.
Unchanged LilyPond narrow/wide SVG and Letter/A4 PDFs need hash checks, not renders.
Baseline failures are recorded separately and never excuse a new failure.

### CI and cost

- Every code/data PR checks freshness, replay, aliases and existing corrections,
  OF and typeset contracts. Include direct MEI record/manifest changes.
- PR #158 checks the production build after Pagefind and before artifact upload.
  A downloaded-artifact recheck is an optional I follow-up, not already built.
- I adds required `identity-parity` in `site.yml` with pinned base/head checkouts,
  no upload secrets, report artifacts on success/failure and a deploy/check gate.
  Gate by identity/adapter paths, but assert both SHAs so a skip cannot count as
  acceptance. Retain this gate for those paths after rollout.
- B records install, production build, fixture build and browser timings. Start
  with a 30-minute job timeout; review measured cost before acceptance. Historical
  two-build timing excludes installs/fixtures/suites and is not a CI estimate.
  Freeze only measured nondeterminism; do not double all browser suites by default.

## 12. Deploy budget guard

Built in [PR #158](https://github.com/npadley/cantusorgani/pull/158), on
`origin/claude/deploy-size-guard`: `web/scripts/check-deploy-size.ts`.
Use `node web/scripts/check-deploy-size.ts web/dist` after the production build.
Do not create a second helper or claim this branch is already merged/deployed.

The helper counts uploadable assets using Wrangler's ignore list: root
`_worker.js`, `_redirects`, `_headers`, `_routes.json`, `functions`, `.wrangler`;
and `.DS_Store`, `node_modules`, `.git` everywhere. It follows symlinks with
`stat`, as Wrangler does. Redirect classification examines only each rule's
source for splats/placeholders. It reports files, separate static/dynamic counts
and the largest file, with CI annotations and a step summary.

| Measure | Warn (exit 0) | Fail (exit 1) |
|---|---|---|
| Uploadable files | `>= 15000` | `>= 19000` |
| Static redirect rules | `>= 1500` | `> 2000` |
| Dynamic redirect rules | Count only | `> 100` |
| One asset | Largest size reported | `> 25 MiB` |

These match the built guard, with file headroom below Pages Free's 20,000 limit.
See [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
The 15k warning is about three times today's 5,018-file conservative inventory:
a tripwire, not a scaling plan. The platform report §6 covers growth.
A conservative all-file inventory belongs in parity reporting, separately from
uploadable counts. Kyriale refresh HTML counts as files, not redirect rules.

Keep #158's threshold, ignore-list, size and source-classification tests.
Whole-rule validation and routing/header parity belong to B; the built helper
does not claim them. Optional I follow-ups: recheck the downloaded artifact before
deploy and add the `_headers` 100-rule count to the guard (parity already checks it).

## 13. Tests and review gates

Each build card starts with a failing test and records the failure, then pass.
Mutate fixtures to prove changed music, missing anchors, stale aliases and leaked
graph content fail; baseline-equals-baseline alone is insufficient.

| Area | Required cases |
|---|---|
| Identity | Title/slug rename, page/start move, input reorder, collision, unknown/retired ID, duplicate alias, numbered insertion, `n`→`key` rebind, named-key stability, concurrent ledger union |
| Work boundary | Same incipit/GregoBase stays separate; distinct hymn tones; no-work rubric/container; lender reused; reserved equality and assignments generate nothing |
| Foreign-shape dry run | Test-only numbered hymnal, no PDF page map or system refs, one text with two tunes and one tune with two accompaniments; load, allocate, validate against `identities.json`, resolve aliases; never production data |
| Migration | All 576 items, seven editions, both addenda, every legacy target kind; two bootstraps/replays on pinned baseline data; protected bytes unchanged |
| Corrections | Legacy resolution agrees with replay, stale `was`, lapsed reviews, range order/ownership, hyphenated registered key, all-or-nothing batch, unresolved target; no canonical input |
| Typeset/MEI | Every match/candidate/record referenced; targets, hashes, approvals and publication eligibility unchanged; follow-up gate if C2 cut applies |
| R2 | Compare before/after scan, typeset and MEI upload plans locally; exact keys and content hashes match; assert edition IDs never replace `vol_id` in key derivation |
| Address/SEO | All old routes/anchors, rules, Kyriale refresh, dated I/II Vespers, OF queries, correction links, 404/noindex, headers and generated Function routing |
| UI/export | Stable payloads, must-keep controls, all labels/dates/credits, explicit print CSS review, no-JS content, existing head e2e and conditional fixture PDF proof |
| Capacity | #158's file/static/dynamic/25 MiB boundaries and ignore/source cases |

For the R2 test, capture plans before any upload call using pinned local render
artifacts or fixture stubs; compare scan `r2_key`/`upload_plans`, typeset
`UploadPlan` keys and MEI's verified file map. Never upload, rerender or inject
identity metadata into hashed source bytes. Manifest comparison alone is not
this test. Existing preview keys may differ with commits; they are not releases.

Required integration commands (new commands are implemented by the cards):

```bash
uv run noh identities check
uv run python -m tools.check_identity_migration
uv run noh apply-corrections --check
uv run noh ordinary-form --check
uv run noh typeset-check
uv run noh typeset-mei-stale --fail-on-stale
scripts/check.sh --quick
scripts/check.sh
pnpm --dir web build:e2e
pnpm --dir web test:e2e:export
```

Use §11's public defaults for builds. Also run matched parity and the guard.
B first records stale-MEI and old-address baselines. A new stale approval blocks
the model PR; never patch a digest or carry forward to pass this migration.
Resolve existing staleness separately before claiming clean phase acceptance.
The foreign-shape gate does not wait for the maintainer's pilot item selection.

## 14. Rollback

No assets move, no D1 schema changes and the Worker is untouched in Phase 1.
Before release, record the baseline/candidate commits, last good Pages deployment
ID, candidate deployment ID after release, alias-file SHA-256, ledger and address
inventory. Retain built artifacts and parity reports for at least 30 days, beyond
`site-dist`'s current one-day retention. Maintainer approval still gates merge/deploy.

On regression, restore the last good Pages deployment and revert adapter/reader
code through a PR. Keep ledger allocations, tombstones and aliases; never recycle
IDs. Keep the guard independent so model rollback does not remove it.

Corrections saved after cutover still use legacy storage. Rebuild old compatibility
outputs from the latest accepted overlay; never revert the whole data directory
and lose accepted corrections. Test with a post-cutover correction. Preserve D1
reports, skips, snapshots and audit history. Pages rollback does not roll back
D1/R2; never delete assets or regenerate/revoke MEI to undo identities.

## 15. Build cards and PR split

PRs: **(1) spec + reviews**, **(2) guard #158 (built)**, **(3) model + migration**.
All target `main`. P14–P16 were read on
[PR #155](https://github.com/npadley/cantusorgani/pull/155), via
`git show origin/claude/platform-options-decided:docs/DECISIONS.md`; they are
not on this checkout's baseline. Land that PR, or the maintainer's decided rows,
before implementation claims they are on main. Spec approval precedes implementation.

Each executor gets this spec, named inputs, an isolated worktree under
`.claude/worktrees/identities-<card>` and `feat/identities-<card>` from pinned
`origin/main`, with dependency commits supplied by the coordinator. No push,
merge, remote commands, secrets, uploads, hand-edited generated files or edits
outside the allowlist. Codex leaves changes uncommitted if git metadata is outside
its sandbox. Report under 200 words: paths, checks, failures, open decisions.
The coordinator reads diffs and verifies proving commands; use the other model
family for read-only review subject to AGENTS.md's usage reserve.

**Schedule:** B and M start together. M first delivers `source_refs.py`,
`sources.yml`, schema and the TS parser contract; integrate that slice before S
starts. S can then run alongside M/B. I follows B/M/S and incorporates built #158.
C is deferred, with no active files. At most three active writing cards.
Allow **16–23 person-days**: B 3–4, M 5–7, S 3–4, I 3–4, coordinator review/fixes
2–4. With parallel work, aim for 2–3 calendar weeks; this is not a solo estimate.

**Cut line:** if M passes five days, ship ledger + sources + items/works/settings
+ scan representations + aliases + parity. Move LilyPond/MEI representation
records to a follow-up; retain their protected-byte/stale-approval checks now.
Keep child/Vespers coverage, supported relations and the foreign-shape gate.
Do not reduce parity or silently drop records: the report explicitly records
representation coverage deferred by this cut. Assignments/canonical input remain
pilot work regardless. Re-estimate remaining work at the cut.

**File ownership:** the allowlists below are disjoint. G is historical, with no
active edits; C has none. M alone updates generated model JSON, B alone owns the
address inventory, and I never edits either. I runs checks in scratch copies;
any generated refresh goes back to M before integration. Docs/workflows/CLI are
I's. A new shared file must receive one owner before work starts.

### G — Deploy guard — DONE (PR #158)

- Built on `origin/claude/deploy-size-guard`; no remaining Phase 1 card estimate
  or edit allowlist. Integrate the PR with maintainer approval; do not rebuild it.
- Helper: `web/scripts/check-deploy-size.ts`; tests: `check-deploy-size.test.ts`.
- Proof after integration: `pnpm --dir web exec vitest run scripts/check-deploy-size.test.ts`;
  `node web/scripts/check-deploy-size.ts web/dist` after a §11 production build.
- Artifact recheck and guard header counting are optional I follow-ups below.

### B — Baseline, address and parity tools (3–4 days)

- Goal: prove unchanged reader/export contracts before the model lands.
- May edit: `tools/{compare_identity_dist,check_legacy_addresses}.py`,
  `tests/{test_identity_dist,test_legacy_addresses}.py`,
  `tests/fixtures/identities/addresses/`, `data/identities/legacy-addresses.json`,
  `web/e2e/identity-parity.e2e.ts`.
- Inputs: §§2, 8, 11–13; `docs/SEO.md`, must-keep, existing build/check/export
  scripts, Playwright config and `site.yml` stale-report step. No model dependency.
- First step: pin baseline SHA, save stale-MEI report and old-address inventory;
  “initial fixture” is that commit's `data/`. Run baseline versus baseline.
- Failing tests: changed payload, missing fragment, loop, false 404, leaked graph,
  changed visible credit/date and unexplained bundle reference.
- Done: full inventory and mutation tests pass; routing/headers checked; changed
  bundles explained; conditional PDF checks use only §11 fixtures; timings recorded.
- Prove: `uv run pytest -q tests/test_identity_dist.py tests/test_legacy_addresses.py`;
  `uv run python -m tools.compare_identity_dist --base <base-sha> --head <base-sha> --out /tmp/identity-base-parity`.
- Paired browser proof: `pnpm --dir web exec playwright test e2e/identity-parity.e2e.ts`,
  with `IDENTITY_BASE_DIST=/tmp/identity-base-parity/base/web/dist` and
  `IDENTITY_HEAD_DIST=/tmp/identity-base-parity/head/web/dist`. Test owns §11's
  servers and state; assert distinct endpoints. Use §11 defaults and measured clocks.

### M — Identity core and NOH projection (5–7 days; cut after day 5)

- Goal: stable IDs, deterministic thin graph and a non-PDF model acceptance test.
- May edit: `pipeline/identities/*.py`, `pipeline/{source_refs,catalog}.py`,
  `web/src/lib/{sourceRefs.ts,sourceRefs.test.ts}`, `data/schema/identities.json`,
  `data/identities/{sources.yml,ledger.json,aliases.yml,snapshot.json,aliases.json,migration.json}`,
  `tools/check_identity_migration.py`, `tests/{test_identities,test_identity_migration}.py`,
  `tests/fixtures/identities/model/`.
- Inputs: §§3–6, 8, 13; source/derived paths in §6, section precedence,
  typeset matching, MEI manifest/versions and upload-key code. Read-only otherwise.
- First delivery: `source_refs.py` + `sources.yml` + schema and matching TS parser;
  coordinator integrates it before S. M owns catalogue hooks and core orchestration API.
- Failing tests: example allocations, numbered/key drift, post-replay allocation,
  ledger union conflicts, lender identity, no title merge, non-PDF hymnal load/
  allocate/validate/alias resolution and protected upload plans/bytes.
- Done: every active reference resolves; foreign-shape gate passes; replay never
  reads snapshot; build refuses missing allocation; no protected bytes change.
- API: `build(data, out)`, `check(data)`, `resolve_target(text, data)` returning
  §7's legacy record; module CLI `python -m pipeline.identities` before I wiring.
  `parse_ref(text, known_sources)` / `parseRef(text, knownSources)` return
  `{volume, pdf_page, index}`; callers validate actual system membership.
- Prove: `uv run pytest -q tests/test_identities.py tests/test_identity_migration.py`;
  `uv run python -m tools.check_identity_migration`;
  `pnpm --dir web exec vitest run src/lib/sourceRefs.test.ts`.

### C — Canonical correction input — DEFERRED to the pilot

No Phase 1 estimate, edits or dependency. §7 records its future boundaries.
Source-neutral correction ref validation belongs wholly to S.

### S — Source-neutral labels and refs (3–4 days)

- Goal: fix only §9's named shared seams; preserve every NOH label and selection.
- May edit: `pipeline/{volumes,sections,corrections,hymnlinks,hymnpairings}.py`,
  `data/schema/corrections.json`,
  `web/src/lib/{identities,catalog,vespers,hymnpairings}.ts`,
  `web/src/lib/admin/{targets,scans}.ts`, `web/src/pages/piece/[slug].astro`,
  `web/src/components/{SystemStack,LineupStack}.astro`,
  `tests/test_source_identities.py`, `web/src/lib/sourceIdentities.test.ts`.
- Inputs: §§4, 7, 9–10; M's parser/schema slice, existing labels, hymn links and
  range validation. Depends only on that integrated M slice, not the full graph.
- Failing tests: non-NOH hymn link, hyphenated registered ref/range, unknown
  edition, both addenda, part-less/borrowed/no-source captions and visible credits.
- Done: full label corpus matches; links/order, correction replay and target
  spelling unchanged. No `_candidate_rank`, reference-adapter or segmentation work.
- Prove: `uv run pytest -q tests/test_source_identities.py`;
  `pnpm --dir web exec vitest run src/lib/sourceIdentities.test.ts`;
  `pnpm --dir web typecheck`.

### I — Integrate, replay and document (3–4 days)

- Goal: wire final-write freshness and prove complete Phase 1 parity.
- May edit: `pipeline/{cli,where}.py`, `scripts/{regenerate,check}.sh`,
  `.github/workflows/{site,corrections-batch,catalog-rebuild,publish}.yml`,
  `tests/test_identity_integration.py`, `AGENTS.md`,
  `docs/{ARCHITECTURE,OPERATIONS,EDITING,SEO,GLOSSARY,ADMIN-SETUP}.md`,
  this spec's status; optionally `web/scripts/{check-deploy-size.ts,check-deploy-size.test.ts}`.
- Inputs: this spec, card reports, OPERATIONS, workflows and built #158.
  Depends on B/M/S and #158 integration; no overlap with their active files.
- Failing tests: stale sidecar after each final writer, missing staged sidecars,
  ignored parity failure, post-cutover correction lost on rollback.
- Done: §13 passes, ledger union documented in OPERATIONS' merge section, writer
  matrix wired, release/alias evidence retained 30 days, rollback keeps new edits.
- Optional follow-ups: recheck downloaded deploy artifact; extend the existing
  guard with a 100-rule `_headers` count. These are not claims about #158.
- Prove: `uv run pytest -q tests/test_identity_integration.py`, all §13 commands;
  `uv run python -m tools.compare_identity_dist --base <base-sha> --head <head-sha> --out /tmp/identity-parity`.
  Use actual pinned commits and §11 defaults, not a moving `origin/main`.
- Coordinator reviews full diff and read-only cross-check findings. Do not mark
  this draft approved without the maintainer's decision.

## 16. Risks, limits and maintainer questions

| Risk | Response |
|---|---|
| Provisional works are mistaken for verified global identities | Label them provisional; no deduplication; pilot must review relationships |
| Numbered sections move while keeping a target spelling | Structural-change check and explicit rebind; preserve historical aliases |
| Sidecars become stale after a less-used writer | Integration tests enumerate every catalogue/lineup/correction workflow |
| Identity fields accidentally enter hashed typeset inputs | Keep core outside MEI; byte inventory and stale-approval check block release |
| Parity exceptions hide export/SEO regressions | Raw diffs, explicit per-file reasons, mutation tests and conditional fixture PDF checks |
| Fresh main differs from the old local dist | Union address inventories; classify baseline defects explicitly before merge |
| 2–3 weeks expands into new intake/product work | Defer admission, rights workflow, work hubs and generic recognition |

Remaining maintainer questions, with proposed defaults:

1. Accept provisional per-printed-unit work identities and unresolved containers,
   with cross-source equality deferred to the P15 pilot? Recommended: yes.
2. Which 20–50 reviewed items will exercise two accompaniments, two hymn tunes,
   a repeated edition setting and unaccompanied chant in the next private pilot?
   Answer before any second-source import. The synthetic dry run proceeds now
   without that selection; it is not evidence for admitting a real book.
3. If the old-dist inventory reveals already-broken historical addresses, should
   fixes land first or alongside an explicitly reviewed compatibility exception?
   Recommended: fix separately first; never silently drop them from the baseline.

Unverified here: fresh builds/PDF parity, live D1/R2/deployment state and account
usage, the full address inventory, graph counts and the second-source pilot.
The release gates must establish these where needed; this is a design, not a
completed migration or production audit.
