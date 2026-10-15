# Deferred recovery results

Fresh catalogue judgments: {'approved': 797, 'failed': 18, 'needs-review': 42, 'unsupported': 2}. Eligible current records: 728; all 708 published MEI bytes and boundaries unchanged; zero manifest exclusions.

Recovered 20 of the original 151 deferred sources; 131 remain.

## Remaining decisions and engineering

- On 2026-10-15 the user restored the printed Communion assignments: Exiit sermo for St John (NOH1 p.73), Fili quid fecisti for the first Sunday after Epiphany (p.118). The superseded override is retained in [decision provenance](printed-communion-assignments.json) and Git history.
- Catalogue gaps require printed section targets for S. Annae Introit (NOH3 p.281) and Ego dixi Gradual (NOH2 p.112), followed by full melody checks.
- Proposed target collisions and musical variants require original-page/reference comparisons rather than lower approval thresholds.
- Ambiguous syntax and notation need voice/pitch/duration confirmation against the printed scan; Oravi still has an unresolved df token.
- Four Haec dies compact ties remain under the short-arc gate; their noteheads overlap, so complete tiny contours alone do not justify approval.
- Credo I now converts its printed breaks, but an unmatched-pitch tie and unequal voice ends still need correction.
- Lyric overlaps remain review warnings. No client or compiler resource limits were increased.

## Source-level status

| Source | Current judgment | Eligible | Previous blocker |
|---|---|---|---|
| `vol-1/al_excita_domine.csv.ly` | failed | deferred | zero-duration-extraction |
| `vol-1/gr_benedictus_qui_venit.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/gr_excita_domine.csv.ly` | needs-review | deferred | layout-tie-rendering |
| `vol-1/gr_hodie_scietis.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/gr_salvos_fac_nos.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/gr_tecum_principium.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/gr_tollite_portas.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/gr_viderunt_omnes.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/in_puer_natus_est.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/in_rorate__ps_caeli_enarrant.csv.ly` | failed | deferred | source-unclosed-slur |
| `vol-1/of_ad_te_domine.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/of_confitebor_tibi__deus.csv.ly` | needs-review | deferred | layout-clipping |
| `vol-1/of_deus_enim.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/of_exsulta_satis.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/of_levabo_oculos.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/of_tui_sunt_caeli.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/tr_de_profundis.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/tr_laudate__omnes_gentes.csv.ly` | failed | deferred | mei-tuplet-schema |
| `vol-2/al_domine_in_virtute.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/al_exivi_a_patre.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/al_o_quam_bonus.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/co_non_vos_relinquam.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/gr_beata_gens.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/gr_domine_refugium.csv.ly` | approved | deferred | source-compile-syntax |
| `vol-2/gr_esto_mihi.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/gr_haec_dies_v_benedictus.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/gr_haec_dies_v_dextera.csv.ly` | needs-review | deferred | layout-tie-rendering |
| `vol-2/gr_haec_dies_v_dicant_nunc.csv.ly` | needs-review | deferred | layout-tie-rendering |
| `vol-2/gr_haec_dies_v_dicat_nunc.csv.ly` | needs-review | deferred | source-compile-syntax |
| `vol-2/gr_haec_dies_v_lapidem.csv.ly` | needs-review | deferred | layout-tie-rendering |
| `vol-2/gr_liberasti_nos.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/in_eduxit_eos.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/in_exaudi_domine__adjutor.csv.ly` | approved | yes | layout-tie-rendering |
| `vol-2/in_omnia_quae_fecisti.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/in_protector_noster.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/in_vocem_jucunditatis.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/of_improperium_exspectavit.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/of_meditabor_cum_alleluia.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/of_oravi_deum.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-2/of_precatus_est.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-2/se_lauda_sion.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/al_christo_confixus.csv.ly` | unsupported | deferred | converter-divisio-inside-measure |
| `vol-3/al_te_gloriosus.csv.ly` | approved | yes | source-compile-syntax |
| `vol-3/co_cor_meum.csv.ly` | unsupported | deferred | converter-divisio-inside-measure |
| `vol-3/co_jacob_autem.csv.ly` | needs-review | deferred | layout-clipping |
| `vol-3/in_exsultabo_in_jerusalem.csv.ly` | failed | deferred | mei-tuplet-schema |
| `vol-3/in_multae_tribulationes.csv.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-3/of_calix_benedictionis.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/of_dextera_domini_alleluia.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/of_lauda_jerusalem.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/re_obtulerunt.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/tr_christo_igitur.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-3/tr_non_judicavi.csv.ly` | failed | deferred | source-compile-syntax |
| `vol-5/ad-libitum/gloria_ad_libitum_I.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/ad-libitum/kyrie_ad_libitum_III.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/ad-libitum/kyrie_ad_libitum_IX.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/ad-libitum/kyrie_ad_libitum_VI.ly` | approved | yes | mei-tuplet-schema |
| `vol-5/ad-libitum/kyrie_ad_libitum_VII.ly` | approved | yes | mei-tuplet-schema |
| `vol-5/ad-libitum/kyrie_ad_libitum_XI.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/credo_I.ly` | needs-review | deferred | converter-source-break-inside-measure |
| `vol-5/credo_III.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/credo_IV.ly` | failed | deferred | zero-duration-extraction |
| `vol-5/missa-i/gloria_I.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-ii/agnus_II.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-ii/kyrie_II.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/missa-iii/gloria_III.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-iv/kyrie_IV.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xi/gloria_XI.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xi/kyrie_XI.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xii/gloria_XII.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xiii/kyrie_XIII.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xiv/kyrie_XIV.ly` | approved | yes | converter-source-break-inside-measure |
| `vol-5/missa-xv/sanctus_XV.ly` | approved | yes | mei-tuplet-schema |
| `vol-5/missa-xvii/kyrie_XVIIa.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/missa-xviii/agnus_XVIII.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/missa-xviii/sanctus_XVIII.ly` | approved | yes | mei-tuplet-schema |
| `vol-5/pro-defunctis/co_lux_aeterna.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/pro-defunctis/gr_requiem_aeternam.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/pro-defunctis/of_domine_jesu_christe.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/pro-defunctis/re_libera_me_domine_de_morte.ly` | approved | deferred | converter-source-break-inside-measure |
| `vol-5/pro-defunctis/re_subvenite.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-5/pro-defunctis/tr_absolve.ly` | needs-review | deferred | source-tie-slur-review |
| `vol-1/al_vita_nostra.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/an_cum_angelis.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/an_omnes_collaudant_b.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/co_exiit_sermo.csv.ly` | approved | yes | target-matching-editorial |
| `vol-1/hy_gloria_laus.2.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/hy_gloria_laus.3.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/hy_gloria_laus.4.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/hy_gloria_laus.5.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/hy_gloria_laus.6.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-1/tr_domine_deus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/al_timebunt_gentes.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/al_venite_ad_me.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/al_verba_mea.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/co_petite_cum_alleluia.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/co_si_quis_sitit.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/gr_ego_dixi.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/in_domine_in_tua_misericordia.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/in_exaudivit.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/of_confitebor_domino.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-2/of_emitte_spiritum.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_beata_es.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_custodi_innocentiam.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_habet_in_vestimento.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_in_deo_salutare.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_laetamini.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_missus_est_angelus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_potens_in_terra.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_potestas_ejus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_qui_ad_justitiam.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/al_quia_factus_es.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/an_lumen_ad_revelationem.2.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/an_lumen_ad_revelationem.3.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/an_lumen_ad_revelationem.4.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/an_lumen_ad_revelationem.5.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/an_responsum_accepit.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/co_posuerunt.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/co_quae_est_ista.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/co_regina_mundi_272.csv.ly` | approved | yes | target-matching-editorial |
| `vol-3/co_sedebit_dominus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/co_signa_eos.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/co_vos_estis_lux.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/gr_dominabitur.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_dignus_est_agnus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_gaudeamus__annae.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_judicant_sancti.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_loquetur_dominus.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_probasti.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_timete_dominum.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/in_venite_audite.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/of_ego_dilecto.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/of_postula_a_me.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/of_venite_filii.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/tr_bonum_est_confiteri.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-3/tr_contristatus_sum.csv.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/agnus_dei_ad_libitum_II.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/an_asperges_me__ad_lib3.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/an_asperges_me__ad_lib4.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/gloria_ad_libitum_II.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/gloria_ad_libitum_III.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/gloria_ad_libitum_IV.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/sanctus_ad_libitum_II.ly` | approved | deferred | target-matching-editorial |
| `vol-5/ad-libitum/sanctus_ad_libitum_III.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/agnus_pro_defunctis.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/an_ego_sum_resurrectio.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/an_in_paradisum.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/ca_benedictus_dominus.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/kyrie_pro_defunctis.ly` | approved | deferred | target-matching-editorial |
| `vol-5/pro-defunctis/sanctus_pro_defunctis.ly` | approved | deferred | target-matching-editorial |
| `vol-5/tonus-solemnis.ly` | approved | deferred | target-matching-editorial |
