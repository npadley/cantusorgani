# Kyrie IX format feasibility experiment

This is a throwaway experiment, not a production converter or an approved editor design. No application code or dependencies were changed.

## Source and method

Source: `data/typeset/src/vol-5/missa-ix/kyrie_IX.ly`, with `data/typeset/include/noh2.ily`, compiled with LilyPond 2.26.0.

The XML extraction frontend from https://github.com/xvb8/ly-to-musicxml at commit `5adbd4d9864ad18368ecb2e4909782ab4bbfd258` was used to let LilyPond resolve relative pitches, durations, includes, and music expressions. Its MusicXML translator was not used: it documents dropping simultaneous voices within a staff and does not map this score's lyrics.

`lilypond-resolved.xml` is the extraction snapshot. `convert.py` independently writes MusicXML 4.0 and MEI 5.0 from those resolved events. It is deliberately specific to the four voice contexts and slur-driven lyrics of this score. It is not a catalogue migration tool.

Both outputs preserve four voices on two staves, 358 pitched notes, five invisible skips, 60 printed lyric syllables, ties, slurs, key, and five source line breaks. There are 61 unmetered layout containers at common voice onsets. Their boundaries are invisible except at the original divisions; they do not introduce a regular meter. MusicXML declares `senza-misura`; MEI omits a time signature and marks containers `metcon="false"`. Hidden tuplets preserve LilyPond's scaled accompaniment durations while retaining their original notehead values.

This MEI version uses common notation because the selected LilyPond accompaniment uses modern noteheads and slurs. It does not test the MEI neume module or combining a separate square-neume chant staff with accompaniment.

## Known fidelity differences

- LilyPond's custom lyric/slur spacing engraver is not ported.
- Gregorian minima divisions use approximate breath symbols in both experiments; final divisions use double barlines.
- The stanza/entry markers `*` and `**` are omitted.
- MusicXML requests lyrics above the staff, but Verovio imports them below; MEI places them above. This is a renderer/import difference, not a prohibition in MusicXML.
- Large staff sizes plus fixed source breaks can crowd a system. Automatic reflow changes those line breaks.
- Musical onset values are synchronization coordinates, not a proposal to impose metrical chant performance.

## Validation

Verovio 6.3.0 loaded and rendered both outputs. For every pitched event, its imported onset and MIDI pitch are checked against the compiler-resolved source. See `validation.json`. This is not full schema validation or proof that every engraving detail is preserved.

Browser tested in installed Chrome with Verovio 6.3.0 WebAssembly. Source breaks produced six systems on one A4 page. Setting maximum systems per page to two produced three pages of two systems in both formats. The browser controls support A4, Letter, A5, landscape, three staff sizes, source breaks, and automatic reflow. The comparison fits a 375px viewport without horizontal overflow.

Source breaks use Verovio `breaks="line"`: preserve line breaks while paginating automatically. `breaks="encoded"` ignores the systems-per-page cap; explicit pagination has precedence. The cap is a maximum, not a guarantee of an exact system count.

## Provenance

Generated 2026-10-06 with:
- **ly-to-musicxml** at commit `5adbd4d9864ad18368ecb2e4909782ab4bbfd258` (MIT license) for frontend XML extraction.
- **python-ly** `xml-export.ily` (GPL, **not vendored**) for LilyPond parse-time music-expression tree dump.
- **Verovio** `6.3.0-425dd7b` for layout and validation.
- Produced with `scale: 40`; physical sizes are not representative (DL D8). Production uses `scale: 100`.

## Reproduce

In an isolated Python environment with `verovio==6.3.0`:

    python convert.py
    python build_comparison.py

`lilypond.svg` was rendered directly from the unchanged source and include directory with `lilypond -dbackend=svg`.

The conversation comparison includes static SVG previews and compressed source XML. Its live controls load the pinned Verovio browser build from jsDelivr. The standalone `comparison.html` is a preview wrapper generated using the visualization skill's rendering utility.

## What the experiment establishes

Both encodings can represent this complete free-meter accompaniment and be laid out dynamically in a browser. Neither automatically carries over the bespoke LilyPond engraving. MEI is the more direct route for controlling Verovio's encoding and placement. Keep LilyPond authoritative until the visual differences are accepted or resolved.

Per-container widths, user-defined system/page breaks, and content editing would need editor logic that modifies the encoding and rerenders; these are not demonstrated controls in this probe.
