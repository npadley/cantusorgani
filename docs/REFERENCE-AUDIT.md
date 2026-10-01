# Printed reference audit

Audited the six published NOH volumes against their PDF text layers and printed headings on 2026-09-30. The baseline catalog contained 69 entries without assigned systems and 388 entries with systems. All 457 entries were inspected; zero assigned systems alone does not mean that a scan or a Mass is missing.

## Coverage and source records

- All 69 empty entries have been classified against their own printed source zone. References were transcribed into the source indexes wherever the audit supplied a definite rubric. Entries that list separate parts retain separate part references; they are not converted into a whole-Mass source.
- The nonempty-entry audit found 80 omitted part citations in 34 entries, including seasonal alternatives and three parts covered by a collective citation. Their normalized reference text is now recorded in the indexes. Referenced part boundaries require the reviewed section records; a page citation does not justify using its first system.
- All 195 explicit index rubrics were checked. The existing day links resolved all dated rubrics. Partial citations in a Proper with its own music do not assign that feast’s day to its lender. The only parser failure was the undated Desponsationis rubric: OCR `Pars Ill` meant `Pars III`, citing the Visitation at NOH3 p.254. This OCR error is corrected.
- A direct referenced Common supplies its complete scanned score, even when its part navigation still needs a reviewed boundary. A composed Proper borrowing different parts requires those individual parts, rather than the first cited Common's complete Mass.

## Ownership corrections

The Exaltation of the Holy Cross heading is on NOH3 p.344. Its own Offertory, *Protege Domine*, occupies eight systems on PDF pages 378–379 (printed pp.345–346). Those systems had been assigned to the preceding Holy Name of Mary entry. Holy Name precedes Exaltation in the corrected same-page index order; its own rubric borrows all five parts and contains no separately printed music.

The Palm Sunday blessing and distribution headings on NOH1 p.299 designate distinct music. *Hosanna filio David* belongs to the blessing. The Sunday within the Corpus Christi octave in NOH8 likewise prints its own Magnificat antiphon, *Exi cito*, before the Sacred Heart heading; its borrowed psalms and hymn do not replace that antiphon.

## Whole-Mass choices and omissions

Structured `reference_sources` record only whole-Mass sources:

- NOH1 p.103: Epiphany (p.99) for January 7–12 before the first Sunday after Epiphany, and that Sunday's Mass (p.112) after it.
- St Gregory of Greater Armenia: NOH4 *Statuit* (p.3) outside Eastertide and *Protexisti* (p.29) during Eastertide.
- Thanksgiving: the rubric permits free choice of the Holy Trinity, Holy Spirit, Blessed Virgin Mary, or a canonized saint in the Roman Martyrology. The three explicitly named Masses have source choices at NOH4 pp.134, 146 and 182. The unrestricted saint choice remains in the quoted rubric.
- Saturday after Passion Sunday: the preceding Friday's Mass at NOH1 p.294, with `omit: [tract]`. The printed rubric specifies the omission; it must survive score composition and export.

## Source ambiguities retained

The NOH4 *Matris de Gratia* rubric prints Holy Name of Mary at NOH3 p.334. Its actual heading is at p.344. The index preserves the printed p.334 text; a reviewed target must use p.344 and preserve the feast's separately specified part changes.

Page-less *ut supra* within a Mass generally repeats its own earlier music. It is not a license to create an external whole-Mass choice. St Peter's separate votive Mass on NOH3 p.242 refers back to the preceding Mass's Communion and regular Alleluia, with explicit alternative Introit and Paschal Alleluia references.

The two seasonal Alleluias in the Purity of Mary and other Propers are distinct citations, even when an existing parser collapses their labels. Collective references such as the Holy Lance and Nails' “Graduale cum Tractu, et Offertorium” cite the Passion votive Mass across NOH4 pp.166–172 and must supply all three parts.

The final reviewed catalog contains 528 borrowed section records, all resolved. Separate seasonal verses were verified at their own system boundaries, including the two Paschal Alleluias for Sacred Relics and the St Joseph votive Mass.

Machine-generated raw text and working audit JSON remain outside the repository. The indexes, reviewed section records and source PDFs are the durable evidence; this note summarizes the audit without duplicating their full text.
