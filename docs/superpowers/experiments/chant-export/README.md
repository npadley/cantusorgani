# Chant in export — spike (2026-10-19)

Question: can Exsurge's SVG reach the vector PDF through the existing sanitizer and walker, and what does it emit? Answer and inventory: [spec §5](../../specs/2026-10-19-chant-in-export-design.md#5-getting-exsurges-svg-through-the-sanitizer-and-into-the-pdf-spike-result).

- `render-exsurge.mjs` renders GABC from `data/chants.json` (#1 Alleluia *Laudem Domini*, #277 Gradual *Exaltabo te*, #889 Tract *Qui habitat*) with the vendored Exsurge (`16c626f`) in headless Chromium at widths 430 and 690 units.
- `normalize-to-pdf.ts` is a regex prototype of the normalizer, run through the unchanged `sanitizePageSvg` and `svgToVectorPdf`. All three chants passed; the PDFs embed only Liberation Serif subsets and contain no images.
- `gradual-exaltabo-pdf.png` is the PDF (macOS `sips` render). `gradual-exaltabo-browser.png` is Chromium's render of the normalized SVG; it matches the PDF and Exsurge's own output, apart from small caps.
