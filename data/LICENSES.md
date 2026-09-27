# Licensing

Two bodies of material with different licences live side by side in this project.
Keeping them distinguishable is a design constraint, not a footnote: the data
model must never merge them, or the notice below stops being accurate.

## NOH page images and derived slices — Public Domain

*Nova Organi Harmonia ad Graduale Romanum*, Lemmens Institute / Mechelen,
H. Dessain, 1942. Published with the approbation of Card. J. E. van Roey,
Archbishop of Mechelen, 18 May 1942. The work is in the public domain.

Covered: everything under `pdf-source/` that `data/volumes.yml` registers, every
page render, every cleaned page, every system slice derived from them, and the
page-level structural data in `data/catalog.json` (page ranges, system
references, aspect ratios, folio numbers).

No rights reserved. No attribution required, though attribution is welcome.

## Chant data — CC BY-SA 4.0

GABC chant notation sourced from **GregoBase** (https://gregobase.selapa.net),
licensed CC BY-SA 4.0.

Covered: the `chant` field of every catalog piece, any GABC stored or
redistributed, and every rendering produced from it.

Obligations this project accepts:

1. **Attribution appears on every page that renders a chant** — not in a footer
   only, not in a dismissible dialog, and inside the printed area so it survives
   printing.
2. **Share-alike attaches** to the chant fields and chant renderings, and to any
   derived dataset that incorporates them.
3. **The public-domain scans are licensed separately** and share-alike does NOT
   attach to them. A consumer must be able to take the NOH imagery and page
   structure without inheriting CC BY-SA, so the two are kept in distinct fields
   and distinct asset paths.

## jgabc per-day chant ids — Unlicense (public domain)

`data/jgabc-propers.json` is extracted from `propersdata.js` in
[bbloomf/jgabc](https://github.com/bbloomf/jgabc), which carries the Unlicense.
It records, per day, which parts a Proper has and the GregoBase id of each; the
site uses it to divide Propers into parts and to link each part to GregoBase.
Source commit and sha256 are in the file's header.

## Reference editions — not redistributed

The Corpus Christi Watershed edition (`data/reference-editions.yml`) is read for
page reconciliation only. Its imagery carries burned-in CCWATERSHED.ORG branding
and its front matter includes a modern preface translation credited to D. Cook,
which is under copyright. None of it is published, and `noh doctor` fails if it
is ever registered as a publication source.

## This project's own work

Pipeline code, the hand-transcribed indices in `data/index-*.yml`, and the site
are released under CC BY-SA 4.0 to match the strictest inbound obligation, so
the dataset can be forked and rehosted without asking.

## Open question — GregoBase licence provenance

The GregoBase website states CC BY-SA 4.0 for its chant data, and this project
proceeds on that basis. The upstream dump is distributed via
`gregorio-project/GregoBase` on GitHub, which carries **no LICENSE file**
(checked 2026-09-07). Before the site goes public, confirm the licence directly
with the GregoBase maintainers and record their answer here. If it turns out to
be more restrictive, the `chant` fields and every chant rendering must be
removed; the public-domain NOH scans and page structure are unaffected, which is
precisely why the two are kept in separate fields.

Vendored dump: `vendor/gregobase_online.sql` (untracked, 17.1 MB)
sha256 `3759c60b529b57fa13f696bfacf748d40a285a847d859276667749caa76de080`
retrieved 2026-09-07 from
https://raw.githubusercontent.com/gregorio-project/GregoBase/master/gregobase_online.sql
