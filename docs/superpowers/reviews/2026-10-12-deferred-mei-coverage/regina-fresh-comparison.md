# Regina mundi fresh comparison

Source: `data/typeset/src/vol-3/co_regina_mundi_272.csv.ly` (the `chantMusic` around lines 46–51; lyrics around line 41). Target: chant 1053, Regina mundi, at `part:in-commemoratione-beat-mari-virgine-de-monte-carmelo/communion`. Fresh strict evidence: `build/deferred-coverage/regina-melody-audit.json`.

The unnormalized audit reports 98 source notes versus 109 GABC notes, transposition +8, `diatonic_equal: false`, `difference_kind: pitch-or-order`, and no transformations. That whole-sequence classification cannot establish a body melody difference while the terminal ten-note addition remains. The report identifies that terminal addition after “omnium” as the explicit `<i>T. P.</i> Alleluia` GABC ending. NOH3 p.272 (PDF page 305) prints the Communion through “Salvatorem omnium,” closes the staff, and begins the next feast; it has no Alleluia continuation or clipped system. This is a seasonal appendix absent from this printed setting, not truncation.

For the body, the reported insertion is at GABC note 52 (aligned near “cé/de”). Parent's independent note-level check establishes that this is the extra duplicate B corresponding to the source's tied B4 pair `b'4 ~ b'4` around Lily line 48. The printed p.272 scan visibly has that tied pair at “intercede,” so the source is faithful. Removing the ten-note TP appendix and normalizing that documented tied/repeated attack yields exact equality for all 98 source notes, both diatonic and chromatic, at transposition +8, with no flags.

## Conclusion

- Raw strict comparison remains unequal (98 vs 109) because it does not apply these documented normalizations.
- The 10-note tail is the optional T.P. Alleluia; the single body extra is explained by the printed tied/repeated B4. Neither indicates truncation or a genuine melody variant.
- With those explicit differences accounted for, melody identity is supported. The target was separately checked for accepted collisions; parent reports none, so it is potentially promotable under the approved policy.
