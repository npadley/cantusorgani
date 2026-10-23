# DESIGN review: Phase 1 source-independent identities

Reviewed: the spec, `docs/ui/must-keep.md`, `docs/SEO.md`, brief § 5 and `catalog.ts::volumeLabel`. Scored as a data model: how well it protects readers now and leaves room for the redesign.

**Overall: 7.6/10**

| Dimension | Score | Rationale |
|---|---|---|
| Information hierarchy | 8 | Item, work, setting and representation are separated cleanly, and a scan and a typeset version attach to one setting (§3, §4), as brief § 5.1 needs. The gap is that EF assignments have no per-part slot. |
| Visual consistency | 8 | Visible text stays NOH-exact (§9, "Keep exact NOH presentation"). `volumeLabel` becomes an edition lookup, which is the one risk. |
| State coverage | 6 | Unresolved, unpublished and revoked states are covered. Unknown rights and unmatched item citations have no stated reader-facing outcome. |
| Accessibility | 8 | Nothing changes. Skip link, polarity and print are covered by HTML and CSS parity, but must-keep marks them "No test". |
| Polish vs slop | 8 | Restrained, with no new UI. |

## Findings

1. **SHOULD-FIX: no per-part slot for the inline "one chosen setting per part" model (brief § 5.1).** Assignment has `key`, `slot` and `setting_ids[]`, but § 4 says EF `days` and `linked_days` are retained and does not say what an EF slot is.
   Edit: in § 4, after the Assignment paragraph, add: "For EF Proper assignments, `slot` is the part key (`introit`, `gradual`, …) matching the child item's target, so a future page can offer several `setting_ids` per slot."

2. **SHOULD-FIX: no accompaniment-level rights (brief § 5.3).** Setting has only `attribution`. Rights sit on Edition (`rights_reference`) and Source. A contributed setting in a mixed book needs its own licence and display/export limits. The schema rejects unknown fields, so adding them later forces a schema bump.
   Edit: in the Setting row of § 4, add `rights_reference: string|null`. In § 3 add: "null means unknown and is never shown as a licence; an unknown value hides no existing NOH credit."

3. **SHOULD-FIX: label parity covers only `volumeLabel`.** `SystemStack.astro` (line 162) builds a borrowed-volume label with a fallback, "another volume". `LineupStack.astro` (line 28) falls back to bare "Nova Organi Harmonia". `pagesLabel` builds addendum text such as "Addenda ad Partem III, pp. 3–11" from `Locator.pagination`. § 9 says an unknown edition fails the build, which differs from today's fallback.
   Edit: in § 9, add a row: "`volumeLabel`, `pagesLabel`, borrowed-volume captions and the LineupStack fallback: a test renders every one of the 576 pieces (plus `regina` and `pius-x`) before and after and compares the strings. Keep the part-less fallback for any edition with `part: null`."

4. **SHOULD-FIX: the URL model works, but the one-to-many case is not stated.** A future one-page-per-occasion IA maps today's `/piece/<slug>/` (a container of five works) to several destinations. § 8 notes that servers cannot redirect fragments. `aliases.addresses` carries `entity_ids`, so the data is there.
   Edit: in § 8, add: "Each child-item anchor (`#introit`, `#gradual-2`) is captured with its child `itm_` ID, so a later page can keep or redirect the old piece page without a second URL migration. Phase 1 does not choose the future public slug. Slugs are never identity."
   § 12's redirect budget (about 576 piece rules, against the 1,500 warning) fits a later move of every piece. Say so.

5. **SHOULD-FIX: must-keep has untested items.** Skip link, print stylesheet and the "Catalogued, not yet verified" notice are listed as "No test" or manual in must-keep. Byte-equal HTML covers the skip link and notice. Print CSS is covered only if the bundle diff is read.
   Edit: in § 11, "Export proof", add: "The parity fixture includes emulated print media on a Proper and Kyriale IX (screenshots compared), and a Tab-once check for 'Skip to music' on the piece, Kyriale, OF and Vespers pages."

6. **NIT: `target:tgt_…` deep links.** `/corrections/?target=target:tgt_…` becomes a bookmarkable query form (§ 7).
   Edit: add: "No page, sitemap, `llms.txt` or Report link emits a `tgt_` URL. The form stays noindex, and the canonical ignores the query."

7. **NIT: source identity block fields.** Brief § 5.2 names collection, book, edition and provenance.
   Edit: in the `sources.yml` Edition row, note: "Source = collection, Edition = book/volume. A later edition group adds the 'edition' tier without renaming IDs."

8. **NIT: addenda dates.** § 4 says not to claim 1942 for bound addenda. Add a test that no visible string changes, because current copy may say "1942".

## Checks that pass

- **(a) URLs.** No route, canonical or redirect change. The two existing `_redirects` rules and the Kyriale refresh stay as they are. Opaque UUIDs mean a slug rename never remints an identity.
- **(b) Visible text.** NOH1 `citation_label` is exactly "Nova Organi Harmonia, part I". The NOH3 addenda keep `pagination` and their labels. Findings 3 and 8 are the only places visible text could move.
- **(c) Brief § 5.** Compatible with inline settings, scan-and-typeset as one setting, mixed-source citation (Edition and Locator) and no site-wide credit. Findings 1, 2 and 7 close the gaps.
- **(d) Must-keep.** No feature is removed or hidden. Every export control, the scan/typeset switch, polarity, skip-to-music and print stay, and the parity gate (§ 11) requires them. Finding 5 only strengthens the proof.

## Scope-changing issues

None. No public URL change. Findings 1 and 2 add optional fields only. The maintainer may decide whether to reserve a public-slug policy for the pilot, but Phase 1 does not need it.
