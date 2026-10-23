# Phase 1: source-independent identities

Status: Draft, awaiting review

Date: 2026-10-22. Scope: about 2–3 weeks, before a second collection.

## 1. Decision and result

Add stable identities behind the existing catalogue. An organist sees the same
pages and exports. An editor can keep using every existing correction target.
An importer can identify a work, its accompaniment and its printed source
without treating a NOH slug as the identity of the music.

This implements [P14–P16](../../DECISIONS.md#decided): keep Astro static,
introduce source-independent identities, and follow platform option A.
Those rows are currently on
[the decided-options branch](https://github.com/npadley/cantusorgani/blob/claude/platform-options-decided/docs/DECISIONS.md#decided),
in [PR #155](https://github.com/npadley/cantusorgani/pull/155), not this checkout.
They were read with `git show origin/claude/platform-options-decided:docs/DECISIONS.md`.
The Q1/Q2/Q7 status in this checkout does not supersede the maintainer's decision.

The phase comes from the [platform report](../../reports/2026-10-23-platform-options.md),
“What the evidence says about today” and Option A §§1, 4, 6, 7.
The [content-model report](../../reports/2026-10-19-multiple-sources-and-language-direction.md)
supplies the distinction between work, setting, edition and representation.
P2's correction overlay, P3–P5's source and approval rules, and P8/P9's reading
and export requirements remain in force.

The unapproved redesign brief was read with
`git show claude/redesign-brief-5bd60c:docs/redesign/brief.md`, §5 and “SEO and
public dependencies”. Stay compatible with inline settings and additive URLs;
do not implement its interface, route names, hubs or contribution placeholder.
This spec does not approve a second book, accounts, ingestion or publication.

### Required outcome

- Every current NOH item and address has a stable, checked identity mapping.
- Same inputs produce byte-identical generated outputs. Historical corrections
  replay without rewriting their targets, `was`, provenance or review evidence.
- `catalog.json` remains schema 3 and the site's derived compatibility view.
  Its old IDs, slugs, field order, record order and bytes remain unchanged.
- Existing source files remain authoritative. The new snapshot is derived;
  there is no second editable catalogue and no catalogue database.
- No R2 key, LilyPond source, MEI record, approval digest or published asset changes.
- No new public route, canonical, anchor, search document or export choice.
- A before/after build comparison and a complete old-address test prove this.
- A separate small guard warns at 15,000 deploy files and fails at 19,000.

### Approach chosen

| Approach | Trade-off | Decision |
|---|---|---|
| Rename every old record and convert every writer at once | Fewer adapters later; risks corrections, approvals, exports and D1 together | Do not do this in Phase 1 |
| Add stable IDs, a NOH adapter and a compatibility view | Keeps old writers and published contracts; introduces a small permanent mapping | Use this |
| Add only collection labels | Cheap, but leaves musical identity tied to slugs and page boundaries | Insufficient for P15 |

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

Materialise sources/editions, source items, provisional works, settings,
representations, assignment references and aliases. Keep the graph small and
explicit. Its first purpose is reliable identity and round-trip compatibility.

| Concept | Materialise now | Reserve for the pilot or later |
|---|---|---|
| Work | One provisional identity for each identified printed musical unit; no title-based deduplication | Reviewed equality across sources, separate text and tune graphs, variant families |
| Source | NOH collection metadata and seven edition-volume records | Admission, rights evidence workflow, contributors and other collections |
| Source item | Each legacy Piece as a printed container or standalone item; child items for identified sections/movements and reviewed Vespers music | Arbitrary movement hierarchies and new import adapters |
| Setting/accompaniment | One per independent printed musical unit; scans and transcriptions attach to it | Two accompaniments of one work and a repeated setting across editions |
| Representation | Existing scan ranges, LilyPond files, MEI records and published manifest entries, with their existing status | New renderers, newly approved conversions, redistribution permissions for new books |
| Assignment | Identity links over existing EF, OF and Vespers records | A new universal calendar engine or editing UI |
| Alias | Old IDs, slugs, targets, routes and fragments mapped explicitly | New public work/source routes and redirects for actual future moves |

A work is the musical/textual unit to which settings belong. It is not a date,
book, PDF, public page or every occurrence of an incipit. Phase 1's works are
provisional identities, not a claim to have identified every chant tradition.
External IDs such as GregoBase 132 are references with evidence, never primary
keys and never an instruction to combine records.

Do not invent a work for a rubric-only entry. Keep its source item and existing
reference edges. An undivided compound item gets `classification: unresolved`
and no work until its units are known. It remains readable and exportable through
its container scan representation. Migration coverage includes unresolved items;
it does not force guessed musical divisions to reach 100%.

Known borrowing points to the lender's item/setting. It does not mint another
accompaniment. Explicit repeated use of the same printed item may share its
setting. Separate printings remain separate provisional works/settings unless
an already reviewed relationship establishes the exact same printed object.
Neither matching incipits nor matching GregoBase IDs merges works (P15).

## 4. Files and schema

All new JSON uses `schema_version: 1`. IDs are strings of the typed forms in §5.
Arrays keep musical/printed order where order has meaning; unordered collections
sort by ID. Missing knowledge is null, not an invented author, date or licence.
Schema validation rejects unknown fields and dangling references.

### Source and generated files

| Path | Ownership and purpose |
|---|---|
| `data/identities/sources.yml` | New reviewed source: collection/edition metadata, display labels and adapter policy; editable by hand |
| `data/identities/ledger.json` | New command-managed source: permanent IDs, birth seeds, active locators and tombstones; never regenerated from current labels |
| `data/identities/aliases.yml` | New reviewed source: exceptional identity aliases and their evidence; editable by hand; existing HTTP rules are read from `_redirects` |
| `data/identities/legacy-addresses.json` | Command-captured, reviewed baseline source: routes/fragments from old dist and sitemap, capture hashes and origins |
| `data/identities/snapshot.json` | Generated graph: works, items, settings, representations, assignment links and relationship evidence |
| `data/identities/aliases.json` | Generated lookup tables for IDs, targets and addresses; not a public endpoint |
| `data/identities/migration.json` | Generated input hashes, entity/reference counts and classified unresolved references; no timestamps |
| `data/schema/identities.json` | Schema for the source and output records; tests validate both |

Implementation updates AGENTS.md's source/generated lists and OPERATIONS.md's
regeneration order. This spec-only change edits neither. Existing index, section,
Vespers, OF and hymn YAML remains in place. Do not mass-rewrite those files to
IDs, and never patch generated catalogue or typeset files by hand.

### Sources and editions (`sources.yml`)

Top level: `schema_version: int`, `sources: Source[]`, `editions: Edition[]`.
Every edition is one addressable volume of a published source in Phase 1.
This avoids a redundant volume entity while allowing an edition group later.

| Record | Required fields and types |
|---|---|
| Source | `id: src_ID`, `title: string`, `short_title: string`, `licence_reference: string|null` |
| Edition | `id: edn_ID`, `source_id: src_ID`, `legacy_volume: string|null`, `title: string`, `part: string|null`, `citation_label: string`, `short_label: string`, `sort_order: int`, `adapter: string`, `scan_registry_key: string|null` |
| Edition, continued | `publication_note: string|null`, `provenance_reference: string|null`, `rights_reference: string|null`, `policy: EditionPolicy` |
| EditionPolicy | `show_related_hymns: bool`, `borrow_whole_reference: bool`, `related_hymns_heading: string|null`, `reference_group: string|null` |

For NOH1, `citation_label` is exactly `Nova Organi Harmonia, part I`.
`scan_registry_key: noh1` points to `volumes.yml`, retaining its PDF checksum,
page-map configuration and allowlist. Do not copy those into a second authority.
NOH3's addenda remain pagination segments of its edition; retain `regina` and
`pius-x`, their labels and dates. Do not claim all bound material dates to 1942.

Policy moves existing branching out of shared readers: NOH8 shows related hymns;
NOH7 does not substitute a whole cited litany for an antiphon. Exact current
headings live in policy, including “Related hymn settings in Book VII”. This is
compatibility policy, not evidence that other sources must follow NOH's rules.

### Graph (`snapshot.json`)

Top level: `schema_version`, `sources`, `editions`, `works`, `source_items`,
`settings`, `representations`, `assignments`, `relations`. The first two are
validated projections of `sources.yml`. IDs and associations come from the
ledger; descriptive values and capabilities come from the current inputs.

| Record | Required fields and types |
|---|---|
| Work | `id: wrk_ID`, `title: string|null`, `language: string|null`, `kind: string`, `identity_status: provisional`, `external_refs: ExternalRef[]` |
| SourceItem | `id: itm_ID`, `edition_id: edn_ID`, `parent_id: itm_ID|null`, `classification: container|musical-unit|reference|unresolved`, `title: string|null`, `locator: Locator`, `setting_ids: set_ID[]`, `origin: Origin` |
| Locator | `pagination: string|null`, `printed_pages: [int,int]|null`, `pdf_pages: [int,int]|null`, `system_refs: string[]`, `item_number: string|null` |
| Setting | `id: set_ID`, `work_id: wrk_ID`, `kind: organ-accompaniment|unaccompanied|unspecified`, `source_item_ids: itm_ID[]`, `attribution: string|null`, `identity_status: provisional` |
| Representation | `id: rep_ID`, `kind: scan|lilypond|mei`, `setting_id: set_ID|null`, `source_item_ids: itm_ID[]`, `locator: RepresentationLocator`, `state: string`, `capabilities: Capabilities`, `evidence: Origin[]` |
| Capabilities | `read: bool`, `quick: bool`, `customize_fixed: bool`, `customize_reflow: bool` |
| Assignment | `id: asg_ID`, `calendar: ef1962|of1970|vespers1960`, `key: string`, `slot: string|null`, `variant: string`, `years: string[]`, `seasons: string[]`, `source_item_ids: itm_ID[]`, `setting_ids: set_ID[]`, `origin: Origin` |
| Relation | `from_id: ID`, `to_id: ID`, `kind: borrows|related-hymn|chant-reference`, `status: string`, `evidence: Origin[]` |
| ExternalRef | `authority: string`, `value: string`, `status: string`, `evidence: Origin[]` |
| Origin | `path: string`, `selector: string`, `legacy_target: string|null` |

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
Asset hashes still identify immutable revisions. Unmatched LilyPond sources and
failed/revoked/unpublished MEI records get representation records with null
setting and false publication capabilities where appropriate; do not drop their
review history or create an invented match. A known matched but unpublished
record may have a setting and still have no public reflow capability.

Capabilities mirror today's manifests and fallback rules. An approved record
alone never enables reflow: the published MEI manifest must also name the same
target and render hash. This graph grants no new publication permission.

Assignments are a sidecar over existing calendar data, not another source of
liturgy. EF `days` and `linked_days` retain their distinction. OF retains its
slot, variant, cycles, seasons, missing states and exact lender. Vespers retains
office keys, I/II distinction, repeats, notes and tone-bank provenance. A date
selects an assignment; it does not mint another work or another source item.

### Worked example

The real `dominica-i-adventus` record has ID `noh1-dominica-i-adventus`,
volume `noh1`, printed pp. 3–7 and PDF pp. 29–33. It becomes a container item.
Its Introit becomes a child item, work and setting; its eight systems run from
`noh1/0029/000` up to, but excluding, the Gradual at `noh1/0030/004`.

These proposed IDs are calculated by §5's algorithm, not present in today's data:

```yaml
edition: edn_f1eedd3e-bae0-51ec-8ac2-9fffe817d495  # noh1
container: itm_584f574c-028e-5fbf-a9d3-57970be04d12
introit:
  item: itm_614a61a9-f6a0-50aa-9d7d-6e4d02d6e7b8
  work: wrk_72f0b834-723a-5876-aaaf-7a6878bc6287
  setting: set_14167a29-53a2-5eec-a03b-ed7bb4b22669
  scan: rep_04c1bd82-9d46-564e-8179-bb92a78c7178
  title: Ad te levavi
  external_ref: {authority: gregobase, value: '132', status: label}
```

The example's external-ref status preserves the section's placement evidence;
it does not certify a new cross-source match. The first scan stem stays
`systems/noh1/0029/000-3160d54d7980`. The public address stays
`/piece/dominica-i-adventus/`; no `/work/` route appears.

For Missa IX's Kyrie, the current target is
`movement:ordinarium-missae-ix/kyrie`. Its LilyPond file is
`data/typeset/src/vol-5/missa-ix/kyrie_IX.ly`, and the MEI record is
`data/typeset/mei/records/kyrie_IX.json`. Its render hash is
`640b269879f24af40180e6c68c5dffbd`, artifact SHA-256 is
`14583bb6e9fe8bc6c9d26018f442e6e2ab70d8455400a65ea78e0c15a3b8329c`,
and approval inputs digest is
`350810004bbf58498689d450f15b03240fee4fc89d210f4b16099e8bdeae3ab7`.
Attach IDs in the sidecar; leave every byte of that record unchanged.

## 5. IDs and the permanent ledger

IDs are opaque UUIDs with type prefixes: `src_`, `edn_`, `itm_`, `wrk_`,
`set_`, `rep_`, `asg_`, `tgt_`. Titles, slugs, page numbers and content hashes
are not identities. Consumers must not decode an ID or construct one themselves.

For deterministic initial allocation, use UUIDv5:

```python
namespace = uuid.uuid5(uuid.NAMESPACE_URL, 'https://cantusorgani.org/identity/v1')
# namespace = 5e3764f4-b31d-566d-84f8-c267bc47eebc
ident = prefix + '_' + str(uuid.uuid5(namespace, prefix + '\0' + birth_seed))
```

The seed is a frozen import key, used only at allocation. It may name a legacy
source record without making the resulting work identity source-dependent:
changing that source, title or location never remints the ID.

| Allocation | Birth seed |
|---|---|
| NOH source / edition | `noh` / `noh1` (and each registered volume key) |
| Top-level item | `piece:<legacy full id>`, e.g. `piece:noh1-dominica-i-adventus` |
| Child item, work, setting | Exact effective legacy part/movement target; standalone work/setting uses `piece:<slug>` |
| Reviewed Vespers child | `vespers-source:<reviewed file>:<stable source selector>` |
| Scan representation | `scan:<item birth seed>`; the example uses `scan:part:dominica-i-adventus/introit` |
| LilyPond representation | `lilypond:<source path relative to data/typeset/src>` |
| MEI representation | `mei:<record path relative to data/typeset/mei/records>` |
| Assignment | Calendar + source key + slot + variant + cycle/season discriminator, not generated date order |
| Correction target handle | Exact legacy target, e.g. `piece:dominica-i-adventus` |

Ledger top level: `schema_version`, `namespace`, `entries: LedgerEntry[]`.
Each entry has `id`, `kind`, `birth_seed`, `locator: Origin|null`,
`state: active|retired`, and `legacy_keys: string[]`. Typed references such as
the work for an item are recorded in `links: {role: string, id: ID}[]`.
Separate target handles retain correction semantics even when several targets
refer to one musical unit: `pairing:...` and `part:...` are not interchangeable.

`noh identities allocate --adapter noh` proposes missing entries in stable
seed order and writes them only after validation. Read-only build/check jobs
never allocate. The first migration uses `noh identities bootstrap --adapter noh`;
it refuses a nonempty ledger. Bootstrap twice in separate empty directories must
produce identical ledgers. Subsequent replay takes the ledger as an input.

Never reuse retired IDs or aliases. Duplicate seeds, an ID collision, ambiguous
selectors or two incompatible owners of one legacy key fail with both origins.
Do not resolve collisions by iteration order, random suffixes or fuzzy matching.
A genuine UUID collision needs a reviewed explicit replacement seed recorded in
the ledger; generation may not silently invent it.

Renaming a slug or moving a section changes its locator through
`noh identities rebind --id <ID> --to <locator> --reason <text>`; it retains the
birth seed and old aliases. Record rebindings in an append-only `changes` array
with old/new locators and reason. Splits/joins require explicit reviewed lineage;
Phase 1 supplies no automatic merge command.

Numbered sections need special care. `gradual:2` must not silently switch work
when a row is inserted before it. Compare the old and new ordered section
inventories; structural insert/delete/key changes require reviewed rebindings
or allocations. Title, chant, page and start-system corrections alone retain
IDs. Keep the legacy target pinned to its original item; if an old spelling
would now mean two items, refuse that change until an explicit compatibility
choice is reviewed. Prefer existing named `key` fields for future insertions.
Existing admin section editing must keep working: a writer may explicitly call
allocation for a new unambiguous keyed row in an approved list, including in
`corrections-batch`. Save overlay and ledger changes atomically, with their diff
in the same PR. Existing rows retain IDs. Ambiguous renumbering needs a reviewed
rebind before publication; never silently reassign the earlier row's identity.

## 6. Deterministic migration

### Direction of data flow

```text
NOH scans/indexes -> catalog.base.json
base + reviewed sections + corrections -> catalog.json (existing compatibility view)
reviewed Vespers / OF / hymn / typeset inputs -> their existing derived files
those files + ledger + source metadata -> identity snapshot and alias indexes
existing compatibility files + small identity lookups -> unchanged Astro reader
```

Do not reconstruct the legacy catalogue from a lossy work graph in this phase.
`catalog.json` is retained as the derived NOH compatibility view. The graph is
derived beside it after overlay replay. The adapter also exposes a lossless
`legacy_catalog()` boundary returning the existing schema-3 records; all callers
that need legacy spelling use it. No new IDs enter `Piece.id` or PDF payloads.

The ledger and target resolver must load without importing generated snapshot
data: corrections run before that snapshot exists. Avoid a replay cycle.

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
6. Resolve every relationship listed below through the ledger. Build assignment
   and external-reference sidecars while preserving the original values/evidence.
7. Generate aliases and the migration report. Check completeness, uniqueness,
   no unexpected publication capability and byte equality of protected outputs.

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

New JSON serialization: UTF-8, LF, two-space indent, sorted object keys,
`ensure_ascii=False`, no NaN, one trailing newline. Sort unordered records by ID;
retain arrays for music, sources, corrections and priorities in source order.
No wall clock, absolute path, machine locale, random sample or filesystem order.
Do not impose this new serialization on existing generated files.

The report records `adapter_version`, `input_sha256` by relative path,
entity counts, alias counts and unresolved entries with reasons. Hash source
inputs only, excluding the generated report and itself; include code versions
used by the adapter. Put any run timings in CI artifacts, not tracked JSON.

`tools/check_identity_migration.py` replays twice into independent temporary
directories, with different hash seeds/locales and identical pinned inputs.
It compares bytes and source-file hashes, verifies a second run changes nothing,
and checks historical target/field resolution against current legacy replay.
It must also perform bootstrap twice on the pinned initial fixture, then verify
the checked-in ledger keeps every allocated ID across normal subsequent edits.

Add identity generation after final legacy outputs in `scripts/regenerate.sh`.
Keep the existing two overlay passes and conditional Vespers rebuild. Refresh
the sidecars on `noh correct`, `apply-corrections`, `catalog` and `vespers-lineup`
where their outputs change; use one orchestration helper, not recursive commands.
Check freshness in CI after existing corrections/OF checks. Automated catalogue
writers must include generated identities in their PRs.

## 7. Corrections, admin and D1

Canonical input form: `target:<tgt_ID>`. It names one correction facet with a
fixed legacy kind, not a work globally. For example:

```text
piece:dominica-i-adventus
target:tgt_507fd380-a704-5e9d-9d8a-e6c4dd9052e3
```

Both resolve to the same piece-metadata slot. A work's other settings are never
changed by correcting this source item. `sections:<slug>`, `part:...`,
`pairing:...`, `vespers:...`, `review:...` and `typeset:<file>` receive their own
handles. Movement identifiers used as typeset-match values are also mapped;
they do not become editable correction kinds accidentally.

Phase 1 accepts canonical input but **persists the existing legacy form** for
NOH. Resolve canonical handle -> facet -> current legacy target before validation,
duplicate checks, reading `was`, fingerprinting, saving or dispatching a batch.
This is deliberate compatibility storage, not a mass retargeting of history.
Unknown/retired/ambiguous handles fail; a resolver never guesses from a title.

| Entry point | Change |
|---|---|
| `noh correct`, `correct-batch` | Accept either form; resolve before kind/field rules; preserve all-or-nothing batches and hold rules |
| `noh where` | Keep existing output; add an explicit `--ids` option showing canonical handles and graph IDs |
| Overlay replay | Resolve old forms through the ledger; feed unchanged legacy entries to the current range -> sections -> field replay stages |
| Typeset-match value | Accept a canonical facet only if it denotes an existing eligible piece/part/movement; serialize the current legacy value |
| Admin API and forms | Accept canonical deep-link/input targets; continue emitting existing Report/Edit links and storing legacy targets |
| Corrections Worker | Accept known canonical reader targets, normalize before `parseCorrection` and insert; retain its stricter reader field set |

Use one generated target-alias table with cross-language contract tests. Python,
Pages Functions and Worker consume it at build/deploy time. Do not add a fetch
to the reader's page load, a public identity endpoint or a D1 catalogue lookup.
Client-side correction forms may bundle only the target lookup needed to resolve
canonical query input; `/corrections/targets.json` stays byte-identical.

Canonical input must agree with the supplied legacy `pieceId`; do not silently
correct a mismatched pair. Preserve the `typeset` sentinel, issue category and
`seen` drawing hash. Normalize canonical `typeset` inputs before the existing
source-snapshot trigger sees them. Deduplication must treat old and new input
forms as the same target, including the `seen` distinction for music issues.

The Worker is deployed separately from Pages. Old forms remain emitted, so old
Worker + new Pages and new Worker + old Pages both work. A new canonical API
client is supported only after both accept it. A stale alias table returns an
explicit unknown-target error; it must not insert an unresolved canonical string.
Document deployment ordering; do not silently change the Worker deployment flow.

### No D1 migration in this phase

Keep `corrections.piece_id`, nullable `target`, `seen`, `resolved_by`,
`duplicate_of`, batch fields and audit records as they are. Preserve
`review_skips.target`, typeset draft/snapshot file paths and preview records.
Migration 0004 deduplicates `COALESCE(target, 'piece:' || piece_id)`; 0006 adds
the drawing hash for issues; 0007's trigger expects `typeset:<file>`.
Normalizing at ingress preserves all three without rewriting stored rows.

Test with a local SQLite/D1 fixture made by applying migrations 0001–0008,
including pending, approved, queued, accepted, rejected and duplicate rows,
NULL targets, skips and frozen typeset source snapshots. No production data or
private notes need to be exported for this test.

If implementation proves a database change necessary, stop that card and amend
the spec. It must be a new numbered migration plus matching `rollback/*_down.sql`,
with local forward/backward tests and maintainer-approved remote application.
Never edit migrations 0001–0008 or hide a migration in the model PR.

## 8. Alias and address registry

Identity aliases and HTTP redirects are different. Most aliases never reach
`_redirects`: an unchanged URL needs a mapping, not a redirect to itself.
Phase 1 adds **zero redirect rules** and keeps both existing rules unchanged.

Generated `aliases.json` has:

| Table | Key and value |
|---|---|
| `legacy_ids` | Full `<volume>-<slug>` -> top-level item ID |
| `legacy_slugs` | Exact slug -> top-level item ID; globally unique for NOH |
| `targets` | Legacy target and canonical handle -> `{target_id, kind, entity_id, legacy_target, state}` |
| `addresses` | `{path, fragment|null}` -> `{destination_path, destination_fragment|null, mechanism, entity_ids}` |
| `redirects` | Ordered `{from, to, status}` for existing `_redirects` rules only |

`mechanism` is `identity`, `pages-rule` or `astro-refresh`; keep the existing
mechanism. Address rows may have empty `entity_ids` for utilities or navigation.
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

Examples: `/piece/dominica-i-adventus/`, `/day/tempora/Adv1-0/`,
`/kyriale/ix/#kyrie`, `/piece/ordinarium-missae-ix/`,
`/ordinary-form/advent-1/`, and `/vespers/2025-01-01/`.
Include every captured I Vespers `/vespers/<date>/i/` route and About anchors.
The inventory is not limited to these examples or to today's navigation links.

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
or receive a separately reviewed redirect design. No Bulk Redirects or alias
Function is needed here. See [Cloudflare redirects](https://developers.cloudflare.com/pages/configuration/redirects/).

## 9. Remove shared one-book assumptions

“Remove” means replace shared identity/selection rules, not erase accurate NOH
copy or rewrite scan recognition. Tests use an in-memory non-NOH fixture; it is
never added to production data or routes.

| Seam found in code | Phase 1 action |
|---|---|
| `catalog.py` full ID vs `corrections.py::_pieces` slug vs `catalog.ts::Piece.id` | Name each explicitly as a legacy identifier; resolve through ledger APIs; keep both old values |
| `catalog.ts::volumeLabel` always NOH | Look up exact edition citation label; unknown edition fails at build time instead of receiving NOH credit |
| `pipeline/hymnlinks.py`, `catalog.ts::relatedHymnSettings`, `vespers.ts::hymnSettings` filter `noh7` | Validate reviewed links by target existence, genre, systems and source status, not volume; retain current link membership/order |
| `piece/[slug].astro` gates related hymns on `noh8` and borrowing on `noh7` | Read edition policy; preserve the current heading and behaviour |
| `data/schema/corrections.json` requires `noh\d` and `noh8` refs | Accept registered source keys syntactically, validate membership/ownership in a shared resolver; keep NOH tone rules in its adapter |
| `pipeline/sections.py`, `admin/targets.ts`, `admin/scans.ts`, `hymnpairings.ts` repeat NOH ref patterns | Use source-neutral ref parsing and registered-volume validation; test hyphenated volume keys and unknown refs |
| `coerce(system_range)` splits on every hyphen | Parse two complete refs with an anchored grammar; a future volume key may contain hyphens; preserve cross-volume/order rejection |
| `ordinary_form.py::_candidate_rank` parses `volume[3:]` | Use edition `sort_order`, preserving the existing 1,2,3,4,5,7,8 ranking and all tie-breakers |
| `pipeline/catalog.py::PART_TO_VOLUME`, `web/src/lib/references.ts` Roman map and NOH4 `ad calcem` | Scope to the NOH reference adapter/group; never use NOH4 as a fallback for another collection |
| `typeset/match.py::VOLUME`, filename/page/movement hints | Keep as NOH importer rules; source-neutral representations consume the result, not its filename convention |
| `vespers/reviewed.py`, `lineup.py` load `hymns-noh7.yml` | Retain reviewed filename; loader accepts generic validated linked items; do not rename its history |
| `segment.py`, `parts.py`, index extraction, `vesperitems.py`, volume-specific slicing | Explicit NOH adapter boundary; no general OCR/segmentation framework in this phase |
| `regenerate.sh all`, publish/catalog workflow volume choices | Remain NOH operational allowlists; add identity refresh/check, not arbitrary uploads |
| `ExportBar.astro`, `pdf.ts`, source captions, SEO descriptions and footer | Keep exact NOH presentation/metadata for this corpus; record as presentation debt for the pilot, not generic source authority |
| `indexes.ts` divisions/Kyriale routing and `good-friday.json` external IDs | Preserve current liturgical UI and external references; neither defines a universal work key |

Generic refs remain `<registered-volume>/<four-digit PDF page>/<three-digit
system>`. Allow source keys matching `[a-z][a-z0-9-]{0,63}`; validate an actual
registry member and actual system, not just that regex. Keep old fixed widths
and page bounds in the NOH adapter. Larger/new locator formats await a pilot.
No relaxation of source permissions, correction lengths or typeset path safety.

## 10. File-by-file implementation boundaries

The paths below are proposed implementation, not files changed by this spec.

| Files | Change |
|---|---|
| `pipeline/identities/{model,ledger,aliases,noh,build}.py` (new) | Types/validation, allocation, resolvers, NOH projection and deterministic output; no rendering or network |
| `pipeline/source_refs.py` (new), `pipeline/volumes.py` | Source-neutral ref parser and source-registry lookup; preserve scan allowlist |
| `pipeline/cli.py`, `pipeline/where.py` | `identities` commands and optional identity display; correction command help |
| `pipeline/catalog.py`, `pipeline/corrections.py`, `pipeline/sections.py` | Legacy adapter boundaries, target normalization, generic ref validation, refresh hooks |
| `pipeline/hymnlinks.py`, `pipeline/hymnpairings.py`, `pipeline/ordinary_form.py`, `pipeline/vespers/{reviewed,lineup}.py` | Generic reviewed-link validation, stable lender ordering and identity relationships |
| `web/src/lib/{identities,sourceRefs,identityTargets}.ts` (new) | Build/server lookups, shared ref parser and small client target resolver; no whole-graph browser bundle |
| `web/src/lib/{catalog,vespers,references,hymnpairings}.ts`, `piece/[slug].astro` | Edition labels/policy and generic links; keep route and Piece contracts |
| `web/src/lib/admin/{targets,scans,api}.ts`, `web/src/pages/{admin/edit/index,corrections/index}.astro` | Normalize canonical inputs/deep links; preserve targets JSON and stored target spelling |
| `workers/corrections/src/{schema,index,status}.ts` | Canonical reader-input normalization and old stored-row compatibility |
| `tools/{check_identity_migration,compare_identity_dist,check_legacy_addresses}.py` (new) | Replay, matched-build comparison, complete address resolution |
| `web/scripts/check-deploy-budget.ts` (new), `web/package.json` | Deploy file and redirect budget guard |
| `scripts/{regenerate,check}.sh`, `.github/workflows/site.yml` | Freshness, budget, comparison and CI artifacts |
| `.github/workflows/{corrections-batch,catalog-rebuild,publish}.yml` | Refresh identities before committing generated data; retain current approval/publish boundaries |
| `AGENTS.md`, `docs/{ARCHITECTURE,OPERATIONS,EDITING,SEO,GLOSSARY,ADMIN-SETUP}.md` | New source/generated ownership, commands, rollback and canonical-input deployment order |

`pipeline/typeset/mei/`, rendering settings/includes, `data/typeset/` and export
engines are read-only implementation inputs. New sidecar code belongs outside
the MEI package. `versions.py` hashes `extract.py`/`listen_full.ily` and
`encode.py`/`model.py`/`diagnostics.py`; moving identity fields into those files
would stale approvals. The current manifest matches legacy target + render hash.
Keep that join unchanged. No approval carry-forward should be needed.

## 11. Proving reader and export parity

Add `tools/compare_identity_dist.py`. It has two modes:

```bash
uv run python -m tools.compare_identity_dist --base origin/main --head HEAD --out /tmp/identity-parity
uv run python -m tools.compare_identity_dist --before /tmp/main-dist --after web/dist --out /tmp/identity-parity
```

The first resolves both refs to commit IDs and exports tracked trees into two
temporary directories; it never checks out over a user's work or copies `.env`,
`.dev.vars`, local generated caches or credentials. Use the same pinned Node,
pnpm and lockfiles and explicitly supplied public build variables in both.
Build each with `pnpm --dir <tree>/web install --frozen-lockfile` and
`pnpm --dir <tree>/web build`. Capture the commands, versions, commit IDs and
input hashes. Missing public configuration or a failed build fails the test.
Retain the trees at `<out>/base` and `<out>/head` until the report is reviewed;
their production outputs are `<out>/base/web/dist` and `<out>/head/web/dist`.

Freeze the build clock in the comparison process, including child Node processes,
to the same recorded UTC instant. Test the clock hook first; do not merely assume
`SOURCE_DATE_EPOCH` changes `new Date()`. Retain the committed Vespers generation
window and use identical stale-MEI reports built from each tree. An intentional
window update or content correction belongs in a separate PR.

The second mode compares already-built directories. It cannot attest to build
provenance without manifests supplied by the first mode/CI. Use it for quick
iterations, not as the only acceptance evidence.

### Comparison rules

1. Diff complete relative file lists, including HTML, JSON, sitemap, `_headers`,
   `_redirects`, Pagefind and assets. Report added/deleted bytes and file counts.
2. Compare HTML byte-for-byte after tightly scoped normalization. Also parse
   inline JSON/export datasets and compare values and array order, so incidental
   formatting cannot hide a changed music selection or source path.
3. Compare every standalone JSON payload, not just `catalog.json`; preserve
   target indexes, scan indexes, chant notation and admin review data.
4. Compare sitemap URLs, canonicals, metadata/JSON-LD, noindex, robots, headers
   and redirect rules. `_headers` and `_redirects` should be byte-identical.
5. Run old-address resolution on the captured old-dist inventory and fresh-base
   inventory. Compare all anchors, including source-prefixed composed-page anchors.
6. Produce machine-readable `report.json` and human-readable `report.md`, with
   each differing file, normalized field, reason and old/new digest.

Normalization may map bundler content-hash filenames and their references to
stable logical bundle names using a bijective asset map. Still diff normalized
bundle contents; do not discard JS/CSS or collapse two different files to one.
Freeze timestamps first; strip only specifically enumerated build-only timestamp
fields whose provenance is tested. Never strip visible dates, correction dates,
asset SHA values, MEI inputs, render hashes, anchors or canonical paths.
No blanket hash/date regex, HTML whitespace collapse or omission of Pagefind.

Expected differences are limited to changed implementation bundles and, if
emitted, their maps/preloads. Every such difference needs a path, purpose and
test in the PR report. No unexplained HTML, public JSON or musical payload
difference passes. Search results must stay equivalent even if a reproducible
index packaging difference is explained. New private graph files do not belong
in dist. An allowlist cannot waive missing pages or changed music.

### Export proof

Identical HTML is necessary, not enough. Preserve `exportParts`, selection IDs,
target strings, system sources, source stems, dimensions, ordered parts, chant
IDs, rubrics, manifest target/hash joins and fallback availability.

Run existing browser suites against both baseline and candidate. Add a parity
fixture covering a Proper (`dominica-i-adventus`), numbered Graduals
(`sabbato-temporum-adventus`), Kyriale IX, an OF mixed lender page, dated I/II
Vespers, a standalone hymn and scan-only music. Cover Quick Letter/A4, typeset
and scan fallback; Customize MEI/fixed/scans and chant Off/Before/Only.
Quick remains accompaniment-only. Retain every control in
[must-keep.md](../../ui/must-keep.md), including polarity, skip links and print.

Use identical immutable or pinned test assets in the two browser runs. Compare
page count, MediaBoxes, text, music order and rendered PDF pages at fixed DPI;
ignore only PDF creation timestamps/document IDs, never musical geometry.
Use `web/scripts/verify-export-pdf.ts` for layout verification. For the unchanged
LilyPond assets, compare narrow/wide SVG and Letter/A4 PDF hashes; do not rerender
or republish them to attach IDs. A baseline failure must be recorded separately;
it is not permission to accept a new failure or silently skip that case.

### CI execution

- Every code/data PR: `noh identities check`, replay tests, alias contracts and
  existing corrections/OF/typeset checks; a stale generated graph fails.
- Every production build: budget guard after Pagefind and before artifact upload;
  also recheck the downloaded artifact before deploy.
- Model PR: a required `identity-parity` job in `site.yml`, with two explicit
  checkouts of PR base SHA and candidate SHA and no secrets/upload credentials.
  Run matched builds, address checks and export comparison; upload the report
  on failure or success. Feed its outcome into `check` and the deploy gate.
- Gate the costly comparison by identity-related paths, but include a base/head
  assertion so a skipped job cannot count as phase acceptance. After rollout,
  retain it for identity/adapter changes, not unrelated documentation edits.

## 12. Deploy budget guard

This is independent of the model and can merge first. Cloudflare Pages Free
allows 20,000 files per deploy; these are earlier project thresholds, not a
change of hosting plan. See [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
Both Cloudflare limit pages were checked on 2026-10-22 for this spec.

`node web/scripts/check-deploy-budget.ts web/dist` counts every regular file
under the final output, including Pagefind, JSON, generated redirect HTML and
control files. Count conservatively; do not subtract `_headers` or `_redirects`.
Reject symlinks/unsupported entries and unreadable/missing output rather than
following files outside the deploy root or reporting a false zero.

| Measure | Warn (exit 0) | Fail (exit 1) |
|---|---|---|
| Files | `count >= 15000` | `count >= 19000` |
| Total `_redirects` rules, static + dynamic | `count >= 1500` | `count > 2000` (project budget) |
| Dynamic rules | Report count | `count > 100` |

Ignore blank/comment lines; parse the whole rule and classify wildcard or named
placeholder sources as dynamic. Fail malformed/duplicate-conflicting rules;
never skip a line because the parser does not recognize it. Retain rule order.
The project's 2,000 total budget is deliberately stricter than Cloudflare's
2,000 static + 100 dynamic allowance. Absence of `_redirects` means zero rules;
the route regression test separately detects loss of the current two rules.

Print total files, HTML, chant JSON, Pagefind, other files and rule counts, with
remaining headroom. Emit GitHub warning/error annotations in CI. Include the
counts in the build artifact report. No dashboard call, credential or deployment
is needed to measure them.

Boundary tests: 14,999/15,000/18,999/19,000 files;
1,499/1,500/2,000/2,001 rules; 100/101 dynamic rules; missing output, malformed
rule, comments, trailing newline, hidden file, nested Pagefind and symlink.

## 13. Tests and review gates

Each build card begins with a failing test. Run that test before implementation
and record its expected failure, then the passing result. For comparison tools,
mutate a fixture to prove that changed music, a missing anchor or a stale alias
actually fails; a baseline-equals-baseline pass alone is insufficient.

| Area | Required cases |
|---|---|
| Identity | Rename title/slug, move page/start, reorder input files, collision, unknown ID, retired key, duplicate alias, numbered-section insertion, named-section stability |
| Work boundary | Two identical incipits remain separate; two equal GregoBase IDs remain separate; distinct hymn tones; no-work rubric/container; known borrowed part reuses lender |
| Migration | All 576 items; all seven volumes and both addenda; every target kind; two independent bootstraps/replays; no byte changes in protected files |
| Corrections | Legacy/canonical equivalence, stale `was`, lapsed reviews, mixed-form duplicates, cross-volume range, hyphenated source key, all-or-nothing batch, unresolved target |
| D1/admin | NULL targets, queues/skips/history, dedupe, issue `seen`, sections reports, typeset snapshots, old/new deployment combinations |
| Typeset/MEI | Every match/candidate/record accounted for; no target/hash/input/approval changes; no new reflow eligibility or lost existing eligibility |
| Address/SEO | All old dist/sitemap routes, all anchors, existing rules, Kyriale refresh, dated I/II Vespers, OF queries, corrections links, 404 and noindex |
| UI/export | Both exports and fallback modes, stable selection payloads, all must-keep controls, no-JS content, narrow/wide music and Letter/A4 |
| Capacity | Exact file/redirect boundary tests from §12 |

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

Also run the matched dist/export comparison from §11 and the budget guard.
Compare the stale-MEI result with the pinned baseline before work starts. A new
stale approval blocks the model PR; do not patch a digest or carry it forward to
make an identity-only migration pass. If main is already stale, record that
separately and resolve the baseline issue before claiming clean phase acceptance.

## 14. Rollback

No assets move and no D1 schema changes. Before release, retain the baseline
commit, built artifact, address inventory, identity ledger and comparison report.
The maintainer approves merge/deploy under P11; implementation cards do neither.

If the reader regresses, the maintainer restores the last good Pages deployment,
then reverts adapter/reader code through a PR. Keep ledger allocations and aliases
in git, even when inactive; never recycle IDs. Keep the guard as its own PR so
model rollback does not remove the capacity check.

Corrections saved during Phase 1 use legacy storage and remain replayable by the
old pipeline. Do not revert the entire data directory and discard new accepted
corrections. Rebuild the old compatibility outputs from the latest accepted
overlay. Test this rollback with a correction accepted after the cutover.

If a canonical-aware Worker was deployed, keep its normalization boundary while
rolling back Pages, or withdraw canonical-input support explicitly. Legacy forms
continue to work in either order; stored rows need no conversion. Preserve all
D1 reports, skips, snapshots and audit history. Never delete/overwrite R2 assets,
revoke approvals or regenerate MEI to roll back identities.

## 15. Build cards and PR split

PRs: **(1) spec + reviews**, **(2) deploy guard**, **(3) model + migration**.
All target `main`, including dependent PRs. PR #155 must land, or its decided
rows must be included by the maintainer, before implementation claims P14–P16
are recorded on main. Spec approval precedes product implementation.

Every executor gets this spec plus the named inputs, its own worktree under
`.claude/worktrees/identities-<card>`, and branch `feat/identities-<card>` from
current `origin/main` with dependency commits supplied by the coordinator.
One writer per file set. No push, merge, remote commands, credentials, uploads,
hand-edited generated outputs or edits outside the allowlist. Codex leaves
changes uncommitted where git metadata is outside its sandbox.
Report under 200 words: changed paths, checks, failures, unresolved decisions.
The coordinator checks current diffs and proving commands before integration.

Run at most three cards at once: G, B and M initially; then C and S after M;
then I. B owns comparison tools, M owns identity core, C owns correction
boundaries and S owns site/source assumptions. I alone owns shared integration
scripts/workflows/docs after the other cards land. G's workflow edit lands first.
Budget about 10–15 person-days including review; investigate scope growth before
adding a generic ingestion framework or an identity editor.

### G — Deploy guard (independent PR; 0.5–1 day)

- Goal: catch file/rule growth before deployment.
- May edit: `web/scripts/check-deploy-budget.ts`, its `.test.ts`,
  `web/package.json`, `.github/workflows/site.yml`, `docs/OPERATIONS.md`.
- Inputs: §12, `web/package.json`, `site.yml` browser/artifact/deploy steps.
- Depends on: spec review only; no model files.
- First failing tests: every threshold and malformed-output case in §12.
- Done: post-Pagefind and pre-deploy checks use the same helper; warnings pass,
  limits fail; valid existing output reports two static rules and no dynamic rule.
- Prove: `pnpm --dir web exec vitest run scripts/check-deploy-budget.test.ts`;
  `node web/scripts/check-deploy-budget.ts web/dist` after a production build.

### B — Baseline, address and parity tools (1.5–2 days)

- Goal: make unchanged-reader claims testable before touching the model.
- May edit: `tools/compare_identity_dist.py`, `tools/check_legacy_addresses.py`,
  `tests/test_identity_dist.py`, `tests/test_legacy_addresses.py`,
  `tests/fixtures/identities/addresses/`,
  `data/identities/legacy-addresses.json`, `web/e2e/identity-parity.e2e.ts`.
- Inputs: §§2, 8, 11; `docs/SEO.md`, must-keep, current dist/sitemap,
  `web/scripts/{build-discovery,check-links,verify-export-pdf}.ts`.
- Depends on: spec review; snapshot schema unnecessary.
- First failing tests: changed payload/hash, dropped fragment, redirect loop,
  missing sitemap route, unknown-path 404 and false bundle normalization.
- Done: captures full inventory with provenance; baseline/base passes; mutations
  fail; paired browser outputs compare music geometry and selection contracts.
- Prove: `uv run pytest -q tests/test_identity_dist.py tests/test_legacy_addresses.py`;
  `uv run python -m tools.compare_identity_dist --base origin/main --head origin/main --out /tmp/identity-base-parity`.
- Additional proof: `pnpm --dir web exec playwright test e2e/identity-parity.e2e.ts`
  with `IDENTITY_BASE_DIST=/tmp/identity-base-parity/base/web/dist` and
  `IDENTITY_HEAD_DIST=/tmp/identity-base-parity/head/web/dist` set in its environment.
  The test owns two local static servers for these paths; freeze both browser
  clocks too. It must not accidentally compare one server against itself.

### M — Identity core and NOH projection (2–3 days)

- Goal: allocate permanent IDs and produce a complete deterministic graph.
- May edit: `pipeline/identities/*.py`, `pipeline/source_refs.py`,
  `web/src/lib/sourceRefs.ts`, `web/src/lib/sourceRefs.test.ts`, `data/schema/identities.json`,
  `data/identities/{sources.yml,ledger.json,aliases.yml,snapshot.json,aliases.json,migration.json}`,
  `tools/check_identity_migration.py`, `tests/test_identities.py`,
  `tests/test_identity_migration.py`, `tests/fixtures/identities/model/`.
- Inputs: §§3–6, 8; catalogue, sections, Vespers, OF, hymn and typeset paths
  in §6; `pipeline/sections.py`, `typeset/match.py`, MEI manifest/versions.
- Depends on: spec review. G/B can run beside it.
- First failing tests: real example allocations, no incipit merge, repeated
  Gradual/key stability, exact lender, nonapproved MEI coverage and replay bytes.
- Done: graph covers all inputs, every active reference resolves, protected
  data remains byte-identical; generator refuses unknown IDs instead of minting.
- Interface: `build(data: Path, out: Path)`, `check(data: Path) -> list[str]`,
  `resolve_target(text: str, data: Path) -> {target_id, kind, entity_id, legacy_target}`;
  module entry point `python -m pipeline.identities` mirrors the future CLI.
  Shared parsers `parse_ref(text, known_volumes)` / `parseRef(text, knownVolumes)`
  return `{volume, pdf_page, index}` or fail; callers also check actual systems.
- Prove: `uv run pytest -q tests/test_identities.py tests/test_identity_migration.py`;
  `uv run python -m tools.check_identity_migration`;
  `pnpm --dir web exec vitest run src/lib/sourceRefs.test.ts`.

### C — Correction compatibility (2 days)

- Goal: accept canonical inputs without losing history or changing D1 storage.
- May edit: `pipeline/corrections.py`, `data/schema/corrections.json`,
  `web/src/lib/admin/{targets,api}.ts`,
  `web/src/lib/identityTargets.ts` (new),
  `web/src/pages/{admin/edit/index,corrections/index}.astro`,
  `workers/corrections/src/{schema,index,status}.ts`,
  `tests/test_identity_corrections.py`, `tests/fixtures/identities/corrections/`,
  `web/src/lib/admin/identityCompatibility.test.ts`,
  `workers/corrections/test/identityCompatibility.test.ts`.
- Inputs: §7, correction replay, existing admin compatibility/dedupe/sections
  tests, Worker schema/status and migrations 0001–0008.
- Depends on: M's resolver and alias schema; does not modify M's files.
- First failing tests: legacy/canonical duplicate, stale `was`, mismatched
  `pieceId`, typeset `seen`/snapshot, NULL target and mixed-version fixtures.
- Done: local D1 fixture/history unchanged; same batch produces same legacy
  overlay/log/review outputs; both form generations work with either deployment.
  Shared ref validation replaces NOH patterns in the correction schema/admin
  targets; range parsing accepts registered hyphenated keys without splitting them.
- Prove: `uv run pytest -q tests/test_identity_corrections.py`;
  `pnpm --dir web exec vitest run src/lib/admin/identityCompatibility.test.ts`;
  `pnpm --dir workers/corrections test` and `pnpm --dir workers/corrections typecheck`.

### S — Source-neutral shared readers (2 days)

- Goal: remove the shared assumptions in §9 while preserving NOH output.
- May edit: `pipeline/{volumes,sections,hymnlinks,hymnpairings,ordinary_form}.py`,
  `pipeline/vespers/{reviewed,lineup}.py`, `web/src/lib/{identities,catalog,vespers,references,hymnpairings}.ts`,
  `web/src/lib/admin/scans.ts`, `web/src/pages/piece/[slug].astro`,
  `tests/test_source_identities.py`, `web/src/lib/sourceIdentities.test.ts`.
- Inputs: §§4, 9–10; edition policy, hymn loaders, source refs and lender ranking.
- Depends on: M; runs beside C; C owns correction-schema and admin-target edits.
- First failing tests: a non-NOH hymn link/label, a hyphenated registered source
  ref, unknown edition, addendum citation and identical NOH lender ordering.
- Done: new fixture works without `noh7`/NOH label fallbacks; actual labels,
  hymn lists, refs, lenders and rendered piece content remain identical.
- Prove: `uv run pytest -q tests/test_source_identities.py`;
  `pnpm --dir web exec vitest run src/lib/sourceIdentities.test.ts`;
  `pnpm --dir web typecheck`.

### I — Integrate, replay and document (2–3 days)

- Goal: wire every writer/check and prove the complete Phase 1 result.
- May edit: `pipeline/{cli,catalog,where}.py`,
  `scripts/{regenerate,check}.sh`, `.github/workflows/{site,corrections-batch,catalog-rebuild,publish}.yml`,
  `tests/test_identity_integration.py`, `AGENTS.md`,
  `docs/{ARCHITECTURE,OPERATIONS,EDITING,SEO,GLOSSARY,ADMIN-SETUP}.md`,
  this spec's status, and command-generated `data/identities/*.json` only.
- Inputs: this spec, all card reports, `docs/OPERATIONS.md`, current workflows.
- Depends on: G, B, M, C, S. Rebase before editing G's workflow/doc paths.
- First failing tests: missing freshness after each writer, stale sidecar in
  CI, new approved section allocation, ignored parity failure, post-cutover
  correction lost by rollback.
- Done: all §13 checks pass, parity report has no unexplained differences,
  MEI/asset hashes are unchanged and rollback retains a new correction.
- Prove: `uv run pytest -q tests/test_identity_integration.py`, all §13 commands,
  and `uv run python -m tools.compare_identity_dist --base origin/main --head HEAD --out /tmp/identity-parity`.
- Review: coordinator reads the full diff; other model family reviews identity,
  correction and parity evidence read-only, subject to AGENTS.md's usage reserve.
  Record findings in the PR; do not change the draft status to approved yourself.

## 16. Risks, limits and maintainer questions

| Risk | Response |
|---|---|
| Provisional works are mistaken for verified global identities | Label them provisional; no deduplication; pilot must review relationships |
| Numbered sections move while keeping a target spelling | Structural-change check and explicit rebind; preserve historical aliases |
| Sidecars become stale after a less-used writer | Integration tests enumerate every catalogue/lineup/correction workflow |
| Identity fields accidentally enter hashed typeset inputs | Keep core outside MEI; byte inventory and stale-approval check block release |
| Normalization hides an export or SEO regression | Narrow allowlist, raw digests, mutation tests and paired PDF rendering |
| Canonical targets outrun separately deployed Worker aliases | Keep legacy public output; explicit unknown-ID error and deployment order |
| Fresh main differs from the old local dist | Union address inventories; classify baseline defects explicitly before merge |
| 2–3 weeks expands into new intake/product work | Defer admission, rights workflow, work hubs and generic recognition |

Questions for review, with proposed defaults:

1. Accept provisional per-printed-unit work identities and unresolved containers,
   with cross-source equality deferred to the P15 pilot? Recommended: yes.
2. Accept canonical target input with legacy NOH persistence for Phase 1?
   Recommended: yes; it avoids a D1/history cutover and makes rollback lossless.
3. Which 20–50 reviewed items will exercise two accompaniments, two hymn tunes,
   a repeated edition setting and unaccompanied chant in the next private pilot?
   No answer is needed to migrate NOH, but no second book goes public before it.
4. If the old-dist inventory reveals already-broken historical addresses, should
   fixes land first or alongside an explicitly reviewed compatibility exception?
   Recommended: fix separately first; never silently drop them from the baseline.

Unverified here: fresh baseline/branch build results and PDF equivalence; live
D1 row contents and deployment versions; live R2 bytes/headers; actual account
plan and usage; the complete old-address inventory; exact new graph counts after
effective-unit enumeration; and the second-source pilot. The specified checks
must establish those needed for release. This document claims a checked design,
not a completed migration or a clean production audit.
