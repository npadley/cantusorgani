# Deferred source-error triage (53 sources)

Read-only inventory from cached P5 evidence. Printed page refs are source comments, not independently matched scan files. Corrections affecting pitch/rhythm require direct score comparison.

## 1. `data/typeset/src/vol-1/al_excita_domine.csv.ly` — zero-duration-extraction

Printed source ref: **page i.16**.

- Diagnostic: explicit zero duration source token at line 68:None; source: `e'2*4/2 ~ e'2 ~ e'2*7/4 ~ e'2*4/2 d'2 r2*0/2 \divisioMaxima`
- Diagnostic: explicit zero duration source token at line 78:None; source: `b2*4/2 ~ b2 ~ b2*7/4 ~ b2*4/2 a2 e2*0/2 ~ \divisioMaxima`
- Diagnostic: explicit zero duration source token at line 88:None; source: `g2*4/2 fis2 e2*7/4 d2*4/2 ~ d2 r2*0/2 \divisioMaxima`
- Disposition: Correct extraction only if printed score confirms note/rest value; otherwise editorial decision.

## 2. `data/typeset/src/vol-1/gr_benedictus_qui_venit.csv.ly` — source-tie-slur-review

Printed source ref: **page i.56**.

- Diagnostic: slur start at 29/4 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 54:58; source: `ees'4  f'4 ( g'4 f'4) g'4 ( aes'4) g'4 bes'4 ( g'4 ~ g'4 ( f'4 \divisioMinima`
- Diagnostic: slur start at 77/4 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 59:35; source: `g'4 ( f'4) g'4 ( aes'4 f'4 ees'4 ( f'\prall g'4 f'4 g'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 3. `data/typeset/src/vol-1/gr_hodie_scietis.csv.ly` — source-tie-slur-review

Printed source ref: **page i.44**.

- Diagnostic: slur start at 141/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 59:19; source: `fis'4 a'4 ( fis'4 ( gis'\prall a'4) b'4 ( fis'4) b'4 ( cis''4 \forceBreak`
- Diagnostic: slur start at 701/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 87:53; source: `e'4 ( fis'4 a'4) ~ a'4 ( cis''4 b'4 a'4 gis'4 fis'4 ( gis'\prall a'4 fis'4) \finalis`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 4. `data/typeset/src/vol-1/gr_salvos_fac_nos.csv.ly` — source-tie-slur-review

Printed source ref: **page i.89**.

- Diagnostic: tie at 245/8 in up:chant has no same-pitch target at line 62:4; source: `) ~ bes'4 ( g'4 f'4) \divisioMinima`
- Diagnostic: tie at 78 in up:chant has no same-pitch target at line 77:4; source: `) ~ bes'4 ( a'4) a'4 a'4 ( bes'4) c''4 ( d''4 bes'4) ~ bes'4 ( a'4 bes'4) bes'4 ( a'4) \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 5. `data/typeset/src/vol-1/gr_tecum_principium.csv.ly` — source-tie-slur-review

Printed source ref: **page i.50**.

- Diagnostic: slur start at 159/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 60:17; source: `g'4 bes'4 ( g'4 ( a'\prall bes'4) c''4 ( g'4) c''4 ( d''4) bes'4 ( g'4) bes'4. a'4 ( bes'4 g'4 f'4 g'4) \divisioMaior`
- Diagnostic: slur start at 125/2 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 77:35; source: `c''4 ( d''\prall ees''4 d''4 c''4 ( d''\prall ees''4 d''4 c''4) c''4 \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 6. `data/typeset/src/vol-1/gr_tollite_portas.csv.ly` — source-tie-slur-review

Printed source ref: **page i.18**.

- Diagnostic: slur start at 127/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 45:13; source: `a'4 ( fis'4 ( gis'\prall a'4) b'4 ( fis'4) b'4 ( \once \tweak #'font-size #-4 cis'' ) a'4 ( fis'4) a'4 ( a'4 fis'4) fis'4 ( \once \tweak #'font-size #-4 e' ) fis'4 a'4 ( a'4 a'4) a'4 ( fis'4 ( gis'\prall a'4 b'4.) a'4 ( b'4) cis''4 ( a'4 a'4) b'4 ( b'4 a'4) \singleBar \forceBreak`
- Diagnostic: slur start at 165/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 45:192; source: `a'4 ( fis'4 ( gis'\prall a'4) b'4 ( fis'4) b'4 ( \once \tweak #'font-size #-4 cis'' ) a'4 ( fis'4) a'4 ( a'4 fis'4) fis'4 ( \once \tweak #'font-size #-4 e' ) fis'4 a'4 ( a'4 a'4) a'4 ( fis'4 ( gis'\prall a'4 b'4.) a'4 ( b'4) cis''4 ( a'4 a'4) b'4 ( b'4 a'4) \singleBar \forceBreak`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 7. `data/typeset/src/vol-1/gr_viderunt_omnes.csv.ly` — source-tie-slur-review

Printed source ref: **page i.61**.

- Diagnostic: slur start at 45/2 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 58:36; source: `)  a'4 ( fis'4 g'\prall a'4 g'4 e'4 ( fis'\prall g'4 fis'4 e'4) d'4 ( e'4 d'4) d'4 ( fis'4 a'4.) d'4 ( fis'4 a'4) ~ a'4 ( gis'4 e'4.) d'4 ( fis'4 e'4) fis'4 ( e'4) ~ e'4 ( d'4) \finalis \forceBreak`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 8. `data/typeset/src/vol-1/in_puer_natus_est.csv.ly` — source-tie-slur-review

Printed source ref: **page i.60**.

- Diagnostic: slur start at 201/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 61:113; source: `a'4 ( cis''4) b'4 e'4 ( \once \tweak #'font-size #-4 a' ) a'4 a'4 ( a'4) ~ a'4 ( fis'4) fis'4 fis'4 ( a'4 fis'4 ( gis'\prall a'4) e'4 ( fis'4 e'4) e'4 \finalis`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 9. `data/typeset/src/vol-1/in_rorate__ps_caeli_enarrant.csv.ly` — source-unclosed-slur

Printed source ref: **page i.38**.

- Diagnostic: slur starting at 41 in up:chant never stops
- Disposition: Unclosed slur: compare source span to printed arc; add closing delimiter only if score shows it ends there.

## 10. `data/typeset/src/vol-1/of_ad_te_domine.csv.ly` — source-tie-slur-review

Printed source ref: **page I.6**.

- Diagnostic: tie at 61/8 in up:chant has no same-pitch target at line 50:4; source: `) ~ c''4 ( a'4 g'4) a'4 c''4 ( c''4 c''4) a'4 a'4 ( b'4 g'4 a'4) a'4 ( b'4 a'4) a'4 \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 11. `data/typeset/src/vol-1/of_deus_enim.csv.ly` — source-tie-slur-review

Printed source ref: **page i.58**.

- Diagnostic: slur start at 5/2 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 45:96; source: `\tieDown  g'4 ees'4 ( g'4 f'4) f'4 f'4  g'4 ( \once \tweak #'font-size #-4 f' ) g'4 ( bes'4 g'4 ( a'\prall bes'4) f'4 \divisioMinima`
- Diagnostic: slur start at 55/2 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 55:40; source: `f'4 f'4 bes'4 ( bes'4 bes'4) g'4 ( f'4 ( g'\prall a'4 g'4) g'4 ( f'4) ~ f'4 ( ees'4) \divisioMinima`
- Diagnostic: tie at 105/8 in up:chant has no same-pitch target at line 49:4; source: `) ~ bes'4 ( g'4 f'4 f'4) ees'4 ( \once \tweak #'font-size #-4 f' ) f'4 f'4 ( g'4 ees'4 f'4) f'4 f'4 ( g'4 f'4) f'4 \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 12. `data/typeset/src/vol-1/of_exsulta_satis.csv.ly` — source-tie-slur-review

Printed source ref: **page i.37**.

- Diagnostic: tie at 55/8 in up:chant has no same-pitch target at line 47:4; source: `) ~ bes'4 ( g'4 f'4) ~ f'4 ( ees'4) g'4 ( a'4 g'4 a'4 f'4) \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 13. `data/typeset/src/vol-1/of_levabo_oculos.csv.ly` — source-tie-slur-review

Printed source ref: **page i.181**.

- Diagnostic: layers of data/typeset/src/vol-1/of_levabo_oculos.csv.ly end at different onsets
- Diagnostic: tie at 157/4 in up:chant has no same-pitch target at line 59:4; source: `) ~ ees'4 ( f'4 ees'4 f'4) c'4 ( ees'4 f'4 d'4) ees'4 ( f'4 c'4 bes4 c'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 14. `data/typeset/src/vol-1/of_tui_sunt_caeli.csv.ly` — source-tie-slur-review

Printed source ref: **page i.64**.

- Diagnostic: slur start at 117/4 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 58:11; source: `g'4 ( e'4 ( fis'\prall g'4) g'4 g'4 ( g'4 g'4) b'4 ( a'4 g'4 e'4.) a'4 ( g'4 fis'4 e'4) e'4 ( fis'\prall g'4 e'4) e'4 \divisioMaior`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 15. `data/typeset/src/vol-1/tr_de_profundis.csv.ly` — source-tie-slur-review

Printed source ref: **page i.134**.

- Diagnostic: tie at 747/8 in up:chant has no same-pitch target at line 88:4; source: `) ~ bes'4 ( a'4 g'4) a'4 ( g'4 f'4) g'4 ( f'4) \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 16. `data/typeset/src/vol-2/al_domine_in_virtute.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.155**.

- Diagnostic: tie at 381/8 in up:chant has no same-pitch target at line 63:4; source: `) ~ c''4 ( bes'4 g'4 f'4) a'4. f'4 ( g'4 f'4) bes'4 ( a'4) g'4 ( a'4 f'4) f'4 \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 17. `data/typeset/src/vol-2/al_exivi_a_patre.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.57**.

- Diagnostic: tie at 89/2 in up:chant has no same-pitch target at line 65:4; source: `) ~ g'4 ( a'4 bes'4 c''4) ~ c''4 ( bes'4 a'4 g'4.) bes'4 ( a'4 g'4) a'4 ( g'4 f'4 g'4) g'4 \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 18. `data/typeset/src/vol-2/al_o_quam_bonus.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.96**.

- Diagnostic: tie at 14 in up:chant has no same-pitch target at line 59:4; source: `) ~ e'4 ( fis'4 g'4 a'4) fis'4 ( g'4 a'4 e'4) ~ e'4 ( d'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 19. `data/typeset/src/vol-2/co_non_vos_relinquam.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.98**.

- Diagnostic: slur start at 87/4 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 53:93; source: `ees'4 ( g'4) f'4 bes'4 ( bes'4 g'4 aes'\prall bes'4 aes'4 f'4 g'\prall aes'4 g'4 f'4 ees'4 ( f'4 g'4 f'4 ees'4 f'4) f'4 ( ees'4) \finalis`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 20. `data/typeset/src/vol-2/gr_beata_gens.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.218**.

- Diagnostic: slur start at 137/8 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 57:67; source: `f'4 g'4 ( a'4 g'4) a'4 ( a'4 g'4 f'4 e'4 f'\prall g'4 f'4 g'4 g'4 ( f'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 21. `data/typeset/src/vol-2/gr_domine_refugium.csv.ly` — source-compile-syntax

Printed source ref: **page ii.244**.

- Diagnostic: not a note name: gg at line 110:1
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 22. `data/typeset/src/vol-2/gr_esto_mihi.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.167**.

- Diagnostic: tie at 23/4 in up:chant has no same-pitch target at line 50:4; source: `) ~ ees'4 ( f'4 g'4) f'4. ees'4 ( f'4 ees'4) ees'4. \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 23. `data/typeset/src/vol-2/gr_haec_dies_v_benedictus.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.28**.

- Diagnostic: tie at 415/8 in up:chant has no same-pitch target at line 67:4; source: `) ~ a'4 ( fis'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"], "a4-p-orig": ["arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630"], "a5-l-orig": ["arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630"], "letter-l-orig": ["arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 22633-22712"], "letter-p-orig": ["arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 17094-17131"]}`

## 24. `data/typeset/src/vol-2/gr_haec_dies_v_dicat_nunc.csv.ly` — source-compile-syntax

Printed source ref: **page ii.9**.

- Diagnostic: octave marks must precede duration at line 124:35
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 25. `data/typeset/src/vol-2/gr_liberasti_nos.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.256**.

- Diagnostic: tie at 385/8 in up:chant has no same-pitch target at line 67:4; source: `) ~ c''4 ( b'4 a'4) b'4 ( g'4) a'4 ( g'4 fis'4) g'4 ( fis'4) \divisioMaxima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 26. `data/typeset/src/vol-2/in_eduxit_eos.csv.ly` — source-compile-syntax

Printed source ref: **page ii.27**.

- Diagnostic: not a note name: l at line 126:11
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 27. `data/typeset/src/vol-2/in_omnia_quae_fecisti.csv.ly` — source-compile-syntax

Printed source ref: **page ii.238**.

- Diagnostic: badly placed octave marks at line 127:47
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 28. `data/typeset/src/vol-2/in_protector_noster.csv.ly` — source-compile-syntax

Printed source ref: **page ii.200**.

- Diagnostic: undefined character or shorthand: ; at line 87:30
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 29. `data/typeset/src/vol-2/in_vocem_jucunditatis.csv.ly` — source-compile-syntax

Printed source ref: **page ii.54**.

- Diagnostic: syntax error, unexpected '\'' at line 139:1
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 30. `data/typeset/src/vol-2/of_improperium_exspectavit.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.140**.

- Diagnostic: tie at 7 in up:chant has no same-pitch target at line 49:4; source: `) ~ c''4 ( a'4) ~ a'4 ( \once \tweak #'font-size #-4 g' )  g'4 ( bes'4 a'4) bes'4 ( g'4 f'4) g'4 ( f'4) ~ f'4 ( e'4) \divisioMaior`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 31. `data/typeset/src/vol-2/of_meditabor_cum_alleluia.csv.ly` — source-compile-syntax

Printed source ref: **page ii.93**.

- Diagnostic: syntax error, unexpected '\'' at line 70:12
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 32. `data/typeset/src/vol-2/of_oravi_deum.csv.ly` — source-compile-syntax

Printed source ref: **page ii.220**.

- Diagnostic: syntax error, unexpected '.' at line 106:59
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 33. `data/typeset/src/vol-2/of_precatus_est.csv.ly` — source-tie-slur-review

Printed source ref: **page ii.191**.

- Diagnostic: layers of data/typeset/src/vol-2/of_precatus_est.csv.ly end at different onsets
- Diagnostic: tie at 94 in up:chant has no same-pitch target at line 94:4; source: `) ~ bes'4 ( a'4 f'4) g'4 ( bes'4 g'4) bes'4 ( g'4 ees'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 34. `data/typeset/src/vol-2/se_lauda_sion.csv.ly` — source-compile-syntax

Printed source ref: **page ii.119**.

- Diagnostic: not a note name: ea at line 353:6
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 35. `data/typeset/src/vol-3/al_te_gloriosus.csv.ly` — source-compile-syntax

Printed source ref: **page iii.338**.

- Diagnostic: unknown command: `\normal' at line 48:104
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 36. `data/typeset/src/vol-3/in_multae_tribulationes.csv.ly` — source-tie-slur-review

Printed source ref: **page iii.211**.

- Diagnostic: slur start at 77/4 in up:chant ignored: a slur is already open (LilyPond ignores it too) at line 57:7; source: `fis'4 ( gis'4 fis'4) fis'4 ( e'4) fis'4 ( gis'\prall a'4) a'4 ( a'4 e'4) \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.

## 37. `data/typeset/src/vol-3/of_calix_benedictionis.csv.ly` — source-compile-syntax

Printed source ref: **page iii.253**.

- Diagnostic: not a note name: aa at line 77:16
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 38. `data/typeset/src/vol-3/of_dextera_domini_alleluia.csv.ly` — source-compile-syntax

Printed source ref: **page iii.173**.

- Diagnostic: not a note name: besm at line 83:12
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 39. `data/typeset/src/vol-3/of_lauda_jerusalem.csv.ly` — source-compile-syntax

Printed source ref: **page iii.165**.

- Diagnostic: not a note name: y at line 101:1
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 40. `data/typeset/src/vol-3/re_obtulerunt.csv.ly` — source-compile-syntax

Printed source ref: **page iii.66**.

- Diagnostic: not a note name: t at line 105:4
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 41. `data/typeset/src/vol-3/tr_christo_igitur.csv.ly` — source-compile-syntax

Printed source ref: **page iii.157**.

- Diagnostic: not a note name: h at line 138:4
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 42. `data/typeset/src/vol-3/tr_non_judicavi.csv.ly` — source-compile-syntax

Printed source ref: **page iii.148**.

- Diagnostic: not a note name: besb at line 115:1
- Disposition: Likely transcription typo, but determine intended pitch/token from printed score before correction.

## 43. `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_III.ly` — source-tie-slur-review

Printed source ref: **page v.127**.

- Diagnostic: layers of data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_III.ly end at different onsets
- Diagnostic: tie at 41/8 in up:#1 has no same-pitch target at line 60:29; source: `r4 \set tieWaitForNote = ##t bes2 ~ s4 bes2*3/2 ~ bes2 ~ bes2*3/2 a2 d'4 \finalis`
- Diagnostic: tie at 41/8 in down:#2 has no same-pitch target at line 80:31; source: `g4 ~ \set tieWaitForNote = ##t g2 ~ s4 g2*3/2 ~ g2 f2*3/2 d2 ~ d4 \finalis`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 44. `data/typeset/src/vol-5/credo_III.ly` — source-tie-slur-review

- Diagnostic: layers of data/typeset/src/vol-5/credo_III.ly end at different onsets
- Diagnostic: tie at 311/4 in down:#3 has no same-pitch target at line 388:10; source: `s4 cis2 d~  \set tieWaitForNote = ##t`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"], "a4-l-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "a4-p-orig": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "a5-l-orig": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "a5-p-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "custom-160x230-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "ipad11-l-large-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "ipad11-p-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "ipadmini-p-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "letter-l-orig": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "letter-p-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "letter-p-large-auto": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "letter-p-orig": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"], "letter-p-small-cap2": ["unison ['0e0397', '1e0180']: heads overlap (0 units apart)"]}`

## 45. `data/typeset/src/vol-5/credo_IV.ly` — zero-duration-extraction

Printed source ref: **page v.110**.

- Diagnostic: explicit zero duration source token at line 273:None; source: `\voiceLine "down" "down" a2*1/2 a2*0/2`
- Diagnostic: explicit zero duration source token at line 276:None; source: `s2*0/2`
- Disposition: Correct extraction only if printed score confirms note/rest value; otherwise editorial decision.

## 46. `data/typeset/src/vol-5/missa-ii/kyrie_II.ly` — source-tie-slur-review

Printed source ref: **page v.11**.

- Diagnostic: layers of data/typeset/src/vol-5/missa-ii/kyrie_II.ly end at different onsets
- Diagnostic: tie at 5/2 in down:#2 has no same-pitch target at line 97:38; source: `r4 e'2 ~ e'2*3/4 c'2*4/2 ~ c'2*3/4 ~ <c' a>2*3/2 ~ a2 ~ a4 ~ \divisioMinima`
- Diagnostic: tie at 18 in down:#2 has no same-pitch target at line 101:38; source: `r4 e'2 ~ e'2*3/4 c'2*4/2 ~ c'2*3/4 ~ <c' a>2*3/2 ~ a2 ~ a4 ~ \divisioMinima`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 47. `data/typeset/src/vol-5/missa-xvii/kyrie_XVIIa.ly` — source-tie-slur-review

Printed source ref: **page v.92**.

- Diagnostic: layers of data/typeset/src/vol-5/missa-xvii/kyrie_XVIIa.ly end at different onsets
- Diagnostic: tie at 37/2 in up:#1 has no same-pitch target at line 54:52; source: `f'4 ~ f'2*3/4 ~ f'2*3/2 ~ \set tieWaitForNote = ##t f'2*2 ~ s4 f'4 \set tieWaitForNote = ##f e'4 c'2*3/2 ~ c'2`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 48. `data/typeset/src/vol-5/missa-xviii/agnus_XVIII.ly` — source-tie-slur-review

Printed source ref: **page v.97**.

- Diagnostic: tie at 13/4 in up:#1 has no same-pitch target at line 43:26; source: `\set tieWaitForNote = ##t f'2 ~ s4 f'4 \set tieWaitForNote = ##f c'2 ~ c'4 \finalis`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 49. `data/typeset/src/vol-5/pro-defunctis/co_lux_aeterna.ly` — source-tie-slur-review

- Diagnostic: tie at 8 in up:#1 has no same-pitch target at line 89:0; source: `g'2*6/4~`
- Diagnostic: tie at 8 in down:#2 has no same-pitch target at line 136:0; source: `e'2*6/4~`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 50. `data/typeset/src/vol-5/pro-defunctis/gr_requiem_aeternam.ly` — source-tie-slur-review

- Diagnostic: layers of data/typeset/src/vol-5/pro-defunctis/gr_requiem_aeternam.ly end at different onsets
- Diagnostic: tie at 489/8 in up:#1 has no same-pitch target at line 90:45; source: `a2*5/2~ a4 cis2~ cis2*2~ cis2*3 e2~ e2*3/2 cis2*2~ s4 cis2*3/2~ cis2*5/2 a2*3/2`
- Diagnostic: tie at 495/8 in down:#3 has no same-pitch target at line 131:27; source: `cis2~ cis2*3/2 fis2*3/2~ fis2*1/2~ s4 fis2*3/2 a,2*5/2 fis2*3/2`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 51. `data/typeset/src/vol-5/pro-defunctis/of_domine_jesu_christe.ly` — source-tie-slur-review

- Diagnostic: layers of data/typeset/src/vol-5/pro-defunctis/of_domine_jesu_christe.ly end at different onsets
- Diagnostic: tie at 22 in up:#1 has no same-pitch target at line 179:0; source: `d'2*4/4~`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 52. `data/typeset/src/vol-5/pro-defunctis/re_subvenite.ly` — source-tie-slur-review

- Diagnostic: layers of data/typeset/src/vol-5/pro-defunctis/re_subvenite.ly end at different onsets
- Diagnostic: tie at 271/8 in down:#2 has no same-pitch target at line 308:0; source: `g2*10/4~`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

## 53. `data/typeset/src/vol-5/pro-defunctis/tr_absolve.ly` — source-tie-slur-review

- Diagnostic: layers of data/typeset/src/vol-5/pro-defunctis/tr_absolve.ly end at different onsets
- Diagnostic: tie at 39/4 in up:#1 has no same-pitch target at line 91:0; source: `cis'2*2/4~`
- Diagnostic: tie at 161/4 in up:#1 has no same-pitch target at line 140:0; source: `cis'2*6/4~`
- Diagnostic: tie at 17/2 in down:#2 has no same-pitch target at line 189:0; source: `b2*4/4~`
- Disposition: Tie/slur fix changes notation semantics; inspect printed page. Invalid ties may be removable only when scan shows no continuation; missing targets/voice-end differences require note/rhythm verification.
- Precheck: `{"piece": ["ties: the MEI has a different number of <tie> elements than the source has tied notes"]}`

