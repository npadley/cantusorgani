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

## Chant data — CC0 (public domain)

GABC chant notation from **GregoBase** (https://gregobase.selapa.net). Its About
page states: "All chant transcriptions are released under CC0 (a.k.a. Public
Domain) license." (checked 2026-09-26). No attribution is required; the site
credits GregoBase anyway, beside every rendered chant.

Covered: `data/chants.json`, the `chant` field of catalog pieces, the chant pages
the site publishes, and every rendering of them.

GregoBase flags some transcriptions `copyrighted` (taken from modern editions
still in copyright). Those are never published: the pipeline reads them only to
recognise a part in the scans, and a part whose chant is flagged gets a link to
GregoBase, never the notation.

## Exsurge — MIT

Chant notation is drawn in the browser by Exsurge, from the maintained fork
[bbloomf/exsurge](https://github.com/bbloomf/exsurge) (MIT, © 2016 Fr. Matthew
Spencer, OSJ), vendored at `web/public/vendor/exsurge/` with its licence and the
commit it was taken from.

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
are released under CC BY-SA 4.0, so the dataset can be forked and rehosted
without asking.

## GregoBase dump

Vendored dump: `vendor/gregobase_online.sql` (untracked, 17.1 MB)
sha256 `3759c60b529b57fa13f696bfacf748d40a285a847d859276667749caa76de080`
retrieved 2026-09-07 from
https://raw.githubusercontent.com/gregorio-project/GregoBase/master/gregobase_online.sql
