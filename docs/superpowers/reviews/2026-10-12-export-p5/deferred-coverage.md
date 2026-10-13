# P5 deferred coverage audit

151 deferred sources are exactly accounted for against859 nonempty source files:708 published +151 deferred. Baseline count82 =41 needs-review +25 failed +16 unsupported;69 additional approved sources have no site target.

| Primary family | Sources |
| --- | ---: |
| zero-duration-extraction | 2 |
| source-tie-slur-review | 34 |
| layout-tie-rendering | 5 |
| source-unclosed-slur | 1 |
| layout-clipping | 2 |
| mei-tuplet-schema | 6 |
| source-compile-syntax | 16 |
| converter-divisio-inside-measure | 2 |
| converter-source-break-inside-measure | 14 |
| target-matching-editorial | 69 |

Lyric collisions remain warnings and are not approval blockers under user direction.
34 source tie/slur review entries have24 invalid tie sources and11 nested-slur sources (one overlaps);credo_III also hasunison-head overlap inall13cases.
16 syntax compilation failures require source transcription corrections against authoritative scores. Two zero-duration extractor errors contain explicit source*0/2 durations;cannot infer intended musical value without editorial review.
Six failed schema packets emitMEItuplet@numbase=0;one unsupported packet additionally hasthisschema error. Correct zero-duration/cross-staff handling, then rerender/revalidate affected inputs.
P5 direct priority:7 layout-only sources (5 tie-rendering,2 clipping), pluscredo_III unison overlap. Existing baseline evidence cannot establish remaining defects in current fresh above-lyrics renderer without focused rerenders.
69 approved unmatched require target mapping/catalogue/editorial decisions;vol-1 10,vol-2 10,vol-3 34,vol-5 15. Do not invent mappings or publish unmapped records.

## Per-source deferred inventory

- `data/typeset/src/vol-1/al_excita_domine.csv.ly` — failed; zero-duration-extraction
- `data/typeset/src/vol-1/gr_benedictus_qui_venit.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/gr_excita_domine.csv.ly` — needs-review; layout-tie-rendering
  - ipadmini-p-auto: tie tev0e0208: crosses a page break and is not fully drawn
- `data/typeset/src/vol-1/gr_hodie_scietis.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/gr_salvos_fac_nos.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/gr_tecum_principium.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/gr_tollite_portas.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/gr_viderunt_omnes.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/in_puer_natus_est.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/in_rorate__ps_caeli_enarrant.csv.ly` — failed; source-unclosed-slur
- `data/typeset/src/vol-1/of_ad_te_domine.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/of_confitebor_tibi__deus.csv.ly` — needs-review; layout-clipping
  - custom-160x230-auto: no pages rendered (CONTENT_CLIPPED: content overhangs the right edge by 0.54 mm)
- `data/typeset/src/vol-1/of_deus_enim.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/of_exsulta_satis.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/of_levabo_oculos.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/of_tui_sunt_caeli.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-1/tr_de_profundis.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/tr_laudate__omnes_gentes.csv.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-2/al_domine_in_virtute.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/al_exivi_a_patre.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/al_o_quam_bonus.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/co_non_vos_relinquam.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-2/gr_beata_gens.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-2/gr_domine_refugium.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/gr_esto_mihi.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/gr_haec_dies_v_benedictus.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
  - a4-p-orig: arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630
  - a5-l-orig: arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630
  - letter-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 22633-22712
  - letter-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 17094-17131
- `data/typeset/src/vol-2/gr_haec_dies_v_dextera.csv.ly` — needs-review; layout-tie-rendering
  - a4-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 16686-16723
  - a5-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 16686-16723
  - letter-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 22806-22887
  - letter-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 17212-17261
- `data/typeset/src/vol-2/gr_haec_dies_v_dicant_nunc.csv.ly` — needs-review; layout-tie-rendering
  - a4-p-orig: arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630
  - a5-l-orig: arc: 2 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 10532-10630
  - letter-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 22633-22712
  - letter-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 17094-17131
- `data/typeset/src/vol-2/gr_haec_dies_v_dicat_nunc.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/gr_haec_dies_v_lapidem.csv.ly` — needs-review; layout-tie-rendering
  - a4-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 16756-16793
  - a5-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 16756-16793
  - letter-l-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 22890-22971
  - letter-p-orig: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie 17271-17320
- `data/typeset/src/vol-2/gr_liberasti_nos.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/in_eduxit_eos.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/in_exaudi_domine__adjutor.csv.ly` — needs-review; layout-tie-rendering
  - custom-160x230-auto: arc: 1 tie/slur piece(s) shorter than 1.0 mm in mid-system, e.g. tie id-ev1e0057c2-tie spanning split-tie 1477-1565
- `data/typeset/src/vol-2/in_omnia_quae_fecisti.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/in_protector_noster.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/in_vocem_jucunditatis.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/of_improperium_exspectavit.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/of_meditabor_cum_alleluia.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/of_oravi_deum.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-2/of_precatus_est.csv.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-2/se_lauda_sion.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/al_christo_confixus.csv.ly` — unsupported; converter-divisio-inside-measure
- `data/typeset/src/vol-3/al_te_gloriosus.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/co_cor_meum.csv.ly` — unsupported; converter-divisio-inside-measure
- `data/typeset/src/vol-3/co_jacob_autem.csv.ly` — needs-review; layout-clipping
  - a5-p-auto: no pages rendered (CONTENT_CLIPPED: content starts 16.39 mm left of the content area)
  - ipad11-l-large-auto: no pages rendered (CONTENT_CLIPPED: content starts 21.74 mm left of the content area)
  - letter-p-auto: no pages rendered (CONTENT_CLIPPED: content starts 16.39 mm left of the content area)
- `data/typeset/src/vol-3/in_exsultabo_in_jerusalem.csv.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-3/in_multae_tribulationes.csv.ly` — needs-review; source-tie-slur-review
- `data/typeset/src/vol-3/of_calix_benedictionis.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/of_dextera_domini_alleluia.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/of_lauda_jerusalem.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/re_obtulerunt.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/tr_christo_igitur.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-3/tr_non_judicavi.csv.ly` — failed; source-compile-syntax
- `data/typeset/src/vol-5/ad-libitum/gloria_ad_libitum_I.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_III.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_IX.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_VI.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_VII.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-5/ad-libitum/kyrie_ad_libitum_XI.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/credo_I.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/credo_III.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
  - a4-l-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - a4-p-orig: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - a5-l-orig: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - a5-p-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - custom-160x230-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - ipad11-l-large-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - ipad11-p-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - ipadmini-p-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - letter-l-orig: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - letter-p-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - letter-p-large-auto: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - letter-p-orig: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
  - letter-p-small-cap2: unison ['0e0397', '1e0180']: heads overlap (0 units apart)
- `data/typeset/src/vol-5/credo_IV.ly` — failed; zero-duration-extraction
- `data/typeset/src/vol-5/missa-i/gloria_I.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-ii/agnus_II.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-ii/kyrie_II.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/missa-iii/gloria_III.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-iv/kyrie_IV.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xi/gloria_XI.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xi/kyrie_XI.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xii/gloria_XII.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xiii/kyrie_XIII.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xiv/kyrie_XIV.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/missa-xv/sanctus_XV.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-5/missa-xvii/kyrie_XVIIa.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/missa-xviii/agnus_XVIII.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/missa-xviii/sanctus_XVIII.ly` — failed; mei-tuplet-schema
- `data/typeset/src/vol-5/pro-defunctis/co_lux_aeterna.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/pro-defunctis/gr_requiem_aeternam.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/pro-defunctis/of_domine_jesu_christe.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/pro-defunctis/re_libera_me_domine_de_morte.ly` — unsupported; converter-source-break-inside-measure
- `data/typeset/src/vol-5/pro-defunctis/re_subvenite.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-5/pro-defunctis/tr_absolve.ly` — needs-review; source-tie-slur-review
  - piece: ties: the MEI has a different number of <tie> elements than the source has tied notes
- `data/typeset/src/vol-1/al_vita_nostra.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/an_cum_angelis.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/an_omnes_collaudant_b.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/co_exiit_sermo.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/hy_gloria_laus.2.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/hy_gloria_laus.3.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/hy_gloria_laus.4.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/hy_gloria_laus.5.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/hy_gloria_laus.6.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-1/tr_domine_deus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/al_timebunt_gentes.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/al_venite_ad_me.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/al_verba_mea.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/co_petite_cum_alleluia.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/co_si_quis_sitit.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/gr_ego_dixi.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/in_domine_in_tua_misericordia.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/in_exaudivit.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/of_confitebor_domino.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-2/of_emitte_spiritum.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_beata_es.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_custodi_innocentiam.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_habet_in_vestimento.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_in_deo_salutare.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_laetamini.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_missus_est_angelus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_potens_in_terra.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_potestas_ejus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_qui_ad_justitiam.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/al_quia_factus_es.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/an_lumen_ad_revelationem.2.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/an_lumen_ad_revelationem.3.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/an_lumen_ad_revelationem.4.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/an_lumen_ad_revelationem.5.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/an_responsum_accepit.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_posuerunt.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_quae_est_ista.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_regina_mundi_272.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_sedebit_dominus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_signa_eos.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/co_vos_estis_lux.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/gr_dominabitur.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_dignus_est_agnus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_gaudeamus__annae.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_judicant_sancti.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_loquetur_dominus.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_probasti.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_timete_dominum.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/in_venite_audite.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/of_ego_dilecto.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/of_postula_a_me.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/of_venite_filii.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/tr_bonum_est_confiteri.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-3/tr_contristatus_sum.csv.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/agnus_dei_ad_libitum_II.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/an_asperges_me__ad_lib3.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/an_asperges_me__ad_lib4.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/gloria_ad_libitum_II.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/gloria_ad_libitum_III.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/gloria_ad_libitum_IV.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/sanctus_ad_libitum_II.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/ad-libitum/sanctus_ad_libitum_III.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/agnus_pro_defunctis.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/an_ego_sum_resurrectio.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/an_in_paradisum.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/ca_benedictus_dominus.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/kyrie_pro_defunctis.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/pro-defunctis/sanctus_pro_defunctis.ly` — approved-unmatched; target-matching-editorial
- `data/typeset/src/vol-5/tonus-solemnis.ly` — approved-unmatched; target-matching-editorial
