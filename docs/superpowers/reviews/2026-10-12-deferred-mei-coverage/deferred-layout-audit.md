# Deferred layout geometry audit

Read-only audit of the seven P5 deferred cases using existing `build/p5-rerenders` evidence, `pipeline/typeset/mei/precheck.py`, and `web/src/lib/export-layout/layout.ts`. No full or targeted rerenders were run.

## gr_excita_domine.csv.ly — layout-tie-rendering

**Finding.** Real page-break tie rendering failure. In ipadmini-p-auto, tie tev0e0208 is emitted as one complete-looking path on p2 (M9873,14115 ... 10385,14115; horizontal span 512 units = 5.12 mm), while report says it crosses page break and is not fully drawn. Single path at destination indicates source-side anchor/page fragment is lost, not a short-arc threshold artifact.

**Minimal direction.** Inspect split-tie emission/anchor page ownership for cross-page ties; test that both page fragments are present and connect at their appropriate page/system edges. Do not change MIN_ARC for this.

## of_confitebor_tibi__deus.csv.ly — layout-clipping

**Finding.** Measured final rendered right overhang is 0.54 mm on custom 160x230 automatic layout. layout.ts compares system maxXMm against content width and emits CONTENT_CLIPPED above RIGHT_EDGE_TOLERANCE_MM. This is a real, small ink overrun, not a page-margin calculation artifact established by current evidence.

**Minimal direction.** Trace the final system maxXMm contributor (likely terminal bar/ornament/last note ink) and reduce only that system’s horizontal demand or improve fit; retain clipping gate until ink is shown to be outside printable content.

## gr_haec_dies_v_dextera.csv.ly — layout-tie-rendering

**Finding.** Reported offending ties include 16686-16723 / 22806-22887 / 17212-17261. The measured short-arc gate is strict span <100 SVG units (1.00 mm); same piece can vary across page formats. Rendered SVG also contains very short tie-like artifacts around edge/unison positions; precheck excludes only page-wide outer 1.2 mm. Existing path evidence confirms <1 mm spans are plausible in crowded unison notation, but does not prove a missing musical tie endpoint.

**Minimal direction.** Before source correction, report each candidate’s endpoints and system-local left/right staff bounds; exclude split-edge continuation stubs by comparing against their own system staff bounds, not a page-wide aggregate. Preserve the 1 mm check for interior arcs.

## gr_haec_dies_v_dicant_nunc.csv.ly — layout-tie-rendering

**Finding.** Same geometric class as dextera: warnings target IDs 10532-10630 / 22633-22712 / 17094-17131. PRECHECK’s <100-unit predicate is path horizontal extent, and not semantic tie connectivity; tightly packed unison ties can be short despite being completely drawn. No evidence justifies lowering global threshold.

**Minimal direction.** Add a semantic distinction for endpoint-identified tie vs partial continuation and evaluate edge distance within the containing system; verify with the targeted mid-system ties.

## gr_haec_dies_v_lapidem.csv.ly — layout-tie-rendering

**Finding.** Same geometric class: IDs 16756-16793 / 22890-22971 / 17271-17320. Existing rendered paths show compressed double-curvature ties of 0.37–0.67 mm in dense multi-voice/unison passages; a simple x-span cutoff labels them stubs without checking complete endpoints.

**Minimal direction.** Use target endpoints / system ownership to determine whether these are complete ties; where complete, exempt only the measured class of compact unison ties with explicit regression coverage, not all short paths.

## in_exaudi_domine__adjutor.csv.ly — layout-tie-rendering

**Finding.** False positive confirmed: id-ev1e0057c2-tie spanning split-tie 1477-1565 has raw path M1207,19814 ... 1295,19814 and width 88 units = 0.88 mm. It is marked as split-tie continuation and sits on a system boundary; precheck sees transformed x=1477..1565. Its special split-tie identity makes this an intentional continuation stub, yet _finish only filters against aggregate page staff limits.

**Minimal direction.** Treat explicit split-tie continuation fragments at a system edge as permitted when the counterpart/source anchor exists, and check edge position against that system’s staff bounds. Keep mid-system short-arc gate intact.

## co_jacob_autem.csv.ly — layout-clipping

**Finding.** True geometry failure under automatic fitting: leftmost system content starts 16.39 mm left of usable-area origin on a5-p-auto and letter-p-auto, and 21.74 mm left on ipad11-l-large-auto. layout.ts reads minXMm and rejects below -BOTTOM_TOLERANCE_MM. Magnitude and persistence across differently proportioned pages indicate a bad/oversized first system anchor or unbounded horizontal extent, not rounding tolerance.

**Minimal direction.** Find which first-system object sets minXMm (likely a pathological lyric/extender/ornament anchor) and constrain/correct its extent or improve horizontal fit; do not widen left clipping tolerance.

## Cross-case recommendation

Make precheck system-aware for arc edge exceptions; keep MIN_ARC=100 as a signal for interior arcs until endpoint checks distinguish genuine ties from compact, complete unison ties. For clipping, preserve CONTENT_CLIPPED gate and fix offending geometry/fit.
