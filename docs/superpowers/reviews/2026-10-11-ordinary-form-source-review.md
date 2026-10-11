# Ordinary Form source and policy review

Reviewed by Codex on 2026-10-11. This records automated and visual source inspection; it is not a claim of approval by a human music editor or diocesan liturgy office.

## Sources actually consulted

- [Graduale Romanum (1974), CMAA scan](https://media.churchmusicassociation.org/books/graduale-romanum-1974.pdf), 919 PDF pages. Image-only scan; printed pagination was checked against the page images. OCR was used to locate rubrics, with visual checks of the corrections below.
- [CMAA summary of GR1974 Sunday and major feast propers](https://media.churchmusicassociation.org/pdf/propers1974.pdf), all six pages. This is a locating/corroboration aid, not a substitute for the book where the summaries differ.
- [Universal Norms and table of liturgical days](https://www.liturgyoffice.org.uk/Calendar/Info/Days.shtml), especially the independent background ranks for privileged weekdays and solemnity transfer rules.
- [USCCB 2025 calendar](https://www.usccb.org/resources/2025cal.pdf) and [2026 calendar](https://www.usccb.org/resources/2026cal.pdf). National additions are not imported. The calendar implementer additionally consulted the published 2027 and 2028 USCCB calendars by browser text; the fixture notes identify their pages. No annual ordo for 2029 or later is claimed as consulted.
- Pinned jgabc `propersdatanovus.js`, commit `3bf01d3c3248fe11ee17a53c8df70e364dc2e89e`, the same revision as the existing EF data. Its assignments are input evidence, not ecclesiastical authority.

## Decisions

The named exceptions remain within scope. General Roman and Sunday transfers are transfer presets; Custom is derived from the individual effective switches. No US national proper calendar is introduced. Christmas Vigil is an evening choice on December 24; Night, Dawn and Day are distinct choices on December 25. Weekday Ordinary Time fallback names the actual preceding Sunday, including an intervening solemnity, and never crosses a season boundary.

The same-rank Sacred Heart / John the Baptist collision recurs in 2033 and 2044. The published 2022 directive is year-specific. The user explicitly approved repeating the June 23 transfer provisionally on 2026-10-11, with a visible notice on June 23 and 24 in those years. This is an approved provisional product policy, not a claim that a standing future directive was found. Replace it if later authoritative guidance differs.

## Assignment checks and corrections

The 60 cycle-sensitive slot maps across all 40 distinct upstream occasions were compared with the six-page CMAA table. These encompass Holy Family, Advent 3, Lent 4/5, Easter 3/5/6/7, Ascension, Trinity, Corpus Christi, Christ the King, and Ordinary Time 2–5, 8–26 and 28, 30–33. Several book checks were needed beyond that abbreviated table:

The vocabulary records this as a partial, slot-scoped review in `source_reviews`: each reviewed upstream occasion names only its `cycle_sensitive_slots`, with reviewer, date, evidence path and citation. `data/ordinary-form/review-manifest.yml` pins the expected 40 occasions and 60 slots; the pipeline derives the required slot list from the pinned source and rejects missing or expanded cycle-slot claims. The occasion-level `reviewed: false` remains accurate because it denotes a complete assignment review, not these partial cycle-map checks. Other review scopes can be added alongside cycle-sensitive slots without changing this gate.

- Advent 3, printed p22, expressly substitutes **Fuit homo** in year B; the abbreviated table omits that exception. Preserve the upstream map.
- Lent 3, p96, permits **Dum sanctificatus** (p249) as an alternative introit. Add GregoBase 418 alongside Oculi mei.
- Lent 3, p99, assigns **Qui biberit** with the Samaritan Gospel and **Passer invenit** (p306) with another Gospel. The normal A/B/C Sunday-reading defaults therefore use Qui biberit (894) in A and Passer invenit (1090) in B/C. Upstream's all-year Qui biberit was corrected. The page also prints another Qui biberit melody; its exact independent GregoBase identity is not established by this review and it is not represented as a verified accompaniment. Optional use of year-A scrutiny readings in B/C is outside the date defaults.
- Lent 4, pp110–111, distinguishes Jerusalem quae aedificatur, Lutum fecit with the blind-man Gospel, and Oportet te / Illumina oculos with the prodigal-son Gospel. Preserve upstream cycle choices.
- Lent 5, p124, distinguishes Videns Dominus, Nemo te condemnavit, and Qui mihi ministrat by Gospel. Preserve upstream cycle choices.
- OT 17, pp314–315, prints Petite **with Alleluia**. The summary table's “sine Alleluia” differs; preserve the book/upstream version.
- OT 23, p333, explicitly substitutes Domine refugium in **year C**. The summary table labels B; preserve the book/upstream C map.
- Annunciation, p553: in Paschal time omit Gradual/Tract and sing the two Alleluias **Ave Maria** (p412, 1209) and **Virga Jesse** (p416, 281). Add seasonal availability and semantic chant kinds; the first Alleluia occupies the first interlectional slot. This prevents the two consecutive chants being presented as alternatives or the first being mislabeled a Gradual.
- Christmas Vigil, pp38–41: Hodie scietis (Introit 150 / Gradual 202), Crastina die (167), Tollite portas (Offertory 171), Revelabitur (367). Added reviewed override rows.
- Christmas Dawn, pp44–47: Lux fulgebit (917), Benedictus qui venit (Gradual 217), Dominus regnavit decorem (714), Deus enim (979), Exsulta filia (1125). Added reviewed override rows.
- Holy Thursday / Good Friday / Easter Vigil were compared with the summary's irregular orders. Empty upstream slots do not imply invented mass propers, nor do upstream first-interlectional labels establish a Gradual chant kind during Easter.

Additional printed references located for future editorial mapping: St Joseph pp552–553; Sacred Heart pp384–387; Lateran p621; second Christmas Sunday requires its own rubric verification. Missing assignment sets remain visibly unmapped, and chants with no exact eligible NOH lender remain “Not in Nova Organi Harmonia”; no incipit-similarity substitutions are authorized.

## Ownership and typeset reuse

Every resolved row borrows an eligible printed catalogue section by exact GregoBase ID. The original lender's reference, correction target, typeset manifest/proofreading state and export range remain authoritative. Borrower anchors are unique per assignment, including year/season alternatives. Synthetic OF pieces do not enter the EF catalogue or editorial queues.

## Follow-ups

Potential upstream reports: Lent 3 B/C Communion, missing Lent 3 alternative Introit, and Annunciation's Paschal-time chants. The table discrepancies above are separate source notes. No external issue or message has been sent; sending requires explicit authorization. Future 2033/2044 collision guidance and the unmatched Lent 3 alternate melody remain documented editorial follow-ups.


The exhaustive collision audit additionally found Thursday Corpus Christi / John the Baptist on 2038-06-24. The user approved provisional Corpus Christi precedence with John the Baptist moved to June 25, disclosed on both affected dates. With Sunday Corpus Christi selected, John remains June 24. This is a product policy awaiting future authoritative corroboration, not a claimed 2038 directive.

## Live asset and export QA

Checked the multi-lender Annunciation page (seven assigned chants) using the current built site served locally at `http://127.0.0.1:8798/ordinary-form/annunciation/`, with the production asset host `https://images.cantusorgani.org`. The production Ordinary Form route still returned 404, as expected before this branch is deployed; the page-level checks below therefore exercise the built branch against live assets, not a deployed Ordinary Form route.

The page loaded the actual `wide.svg` files for hashes `41b1da27ee3dbd28dc7933c439c22930` and `673e3bed761892db9a57ae8b706cf487` with HTTP 200. Switching to scans loaded the actual WebP fallback images with HTTP 200. Export requests for scanned PNG slices (the `?export=1` CORS variant) succeeded for all 51 systems, including lenders from NOH volumes I and IV. A direct probe of `noh1/0064/002-859d50e3cf81@2x.png?export=1` returned HTTP 200, `image/png`, 12,176 bytes, with a valid PNG signature.

For the typeset Rorate introit, the lender is *Dominica IV Adventus*, printed pp. 38–43, system `noh1/0064/002`; its typeset manifest entry is `vol-1/in_rorate__ps_caeli_enarrant.csv.ly`, hash `41b1da27ee3dbd28dc7933c439c22930`. The live Letter and A4 PDFs returned HTTP 200 as `application/pdf` (55,288 and 55,328 bytes); the Letter response headers included `Access-Control-Allow-Origin: *`, and cross-origin fetches from the local page successfully read both PDFs. I visually compared the first typeset PDF page against the corresponding live scan image: the Rorate opening and text are legible and correspond. The mixed assembled PDF was also opened in the browser PDF viewer; its first page is headed “Introit (from Dominica IV Adventus)” and retains the staff/lyrics layout.

All four built-page export combinations completed from the real asset host with no missing-asset or typeset fallback message: all-scan Letter (51 systems, 11 pages, 0.8 MB), all-scan A4 (51, 10, 0.8 MB), mixed Letter (51, 11, 0.7 MB), and mixed A4 (51, 10, 0.7 MB). Browser download events confirmed completion for each; the generated PDF was viewable in the browser. A 390 px-wide screenshot of the built Annunciation page was captured and visually checked for wrapping and control visibility (`/private/tmp/of-browser-qa-2026-10-11/page-2026-10-11T21-36-29-509Z.png`). These checks do not replace testing the feature route after deployment or a music-editor comparison of every borrowed passage.

### Full assembled Annunciation PDF inspection

I saved the actual mixed Letter export to `/private/tmp/of-annunciation-mixed-letter-review.pdf` and inspected all 11 pages, including rendered page images, against the seven resolved rows in `data/ordinary-form-coverage.json`. The pages contain the rows in assignment order: Introit (GregoBase 79, Dominica IV Adventus, 7 systems), Lent Gradual (756, Feria IV Quattuor Temporum Adventus, 10), Paschal Alleluia I (1209, Missa de Sancta Maria in Sabbato—ab Adventu usque ad Nativitatem, 7), Paschal Alleluia II (281, Missa de Sancta Maria in Sabbato—a Purificatione usque ad Pascha, 6), Lent Tract (738, Commune Virginum—pro Virgine tantum, 13), Offertory (843, Dominica IV Adventus, 6), and Communion (1144, Dominica IV Adventus, 2). The PDF contains 51 systems total, matching the coverage ranges.

The section headings and continuations show both Alleluias separately and in the expected order; the Tract follows Alleluia II, then Offertory and Communion. Every section is present. No page is blank and no staff/system was visibly clipped in the rendered pages. Page 9 contains the final single Tract system with substantial white space; it is legible and present, though this page packing could be improved. This is a visual layout check, not a note-for-note music collation. The inspected PDF remains available at `/private/tmp/of-annunciation-mixed-letter-review.pdf`.
