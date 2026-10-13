# Deferred MEI target match audit

Read-only audit of 69 inventory entries, matched to `parts.yml` evidence and current effective editor choices. `melody-audit.json` contains none of the 69 files. The NOH scan PDFs are present under `pdf-source/`. Source page comments are printed folios and map through `data/derived-offsets.json`; I used that mapping with catalogue page ranges. I rendered three pages for direct checks (NOH3 pp.272, 281; NOH2 p.112).

## Main finding

Only one clear effective-state explanation: `co_exiit_sermo` has exact melody and words against `part:s-joannis-apostoli-et-evangelist/communion` (1.00/1.00, p.73) in `parts.yml`, but the effective manifest puts it back in review because correction `c-0029` assigns the same target to `co_fili_quid_fecisti.csv.ly`. It is a source/target collision governed by an explicit editor choice, not musical disagreement.

The remaining proposed rows include page mismatches, accepted target collisions, missing printed section targets, and melody comparisons that remain unresolved. High-scoring rows also have ambiguous target claims: `co_regina_mundi_272` is 1.00/1.00 for both the candidate Carmelite Communion and a second Marian Communion candidate; `in_gaudeamus__annae` overlaps the already matched Agathae source; and `of_venite_filii` competes with `of_postula_a_me`. No safe automatic promotion is established by cached evidence alone.

## Per-source findings

| Source | Cached candidate target | Melody / words | Target evidence | Recommendation |
|---|---|---:|---|---|
| `al_vita_nostra.csv.ly` | `part:noh1-p104/alleluia:paschal` | 0.672 / 0.478 | page; collides: al_beatus_homo.csv.ly, al_beatus_homo.csv.ly | hold ambiguous identity or melody |
| `an_cum_angelis.csv.ly` | `part:noh1-p302/other:3` | 0.364 / 0.443 | page; collides: an_turba_multa.csv.ly | hold ambiguous identity or melody |
| `an_omnes_collaudant_b.csv.ly` | `part:noh1-p302/other:5` | 0.491 / 0.942 | page; collides: an_omnes_collaudant.csv.ly | hold ambiguous identity or melody |
| `co_exiit_sermo.csv.ly` | `part:s-joannis-apostoli-et-evangelist/communion` | 1.0 / 1.0 | page; collides: co_fili_quid_fecisti.csv.ly | strong identity melody but target collision or duplicate candidate |
| `hy_gloria_laus.2.csv.ly` | `part:noh1-p302/other:4` | 0.767 / 0.438 | page; collides: an_coeperunt_omnes_turbae.csv.ly, an_coeperunt_omnes_turbae.csv.ly | hold ambiguous identity or melody |
| `hy_gloria_laus.3.csv.ly` | `part:noh1-p302/other:4` | 0.767 / 0.239 | page; collides: an_coeperunt_omnes_turbae.csv.ly, an_coeperunt_omnes_turbae.csv.ly | hold ambiguous identity or melody |
| `hy_gloria_laus.4.csv.ly` | `part:noh1-p302/other:4` | 0.767 / 0.406 | page; collides: an_coeperunt_omnes_turbae.csv.ly, an_coeperunt_omnes_turbae.csv.ly | hold ambiguous identity or melody |
| `hy_gloria_laus.5.csv.ly` | `part:noh1-p302/other:4` | 0.767 / 0.5 | page; collides: an_coeperunt_omnes_turbae.csv.ly, an_coeperunt_omnes_turbae.csv.ly | hold ambiguous identity or melody |
| `hy_gloria_laus.6.csv.ly` | `part:noh1-p302/other:4` | 0.767 / 0.463 | page; collides: an_coeperunt_omnes_turbae.csv.ly, an_coeperunt_omnes_turbae.csv.ly | hold ambiguous identity or melody |
| `tr_domine_deus.csv.ly` | `part:sanctissimi-nominis-jesu/tract` | — / — | page | requires scan or direct identity evidence |
| `al_timebunt_gentes.csv.ly` | `part:dominica-vii-post-pentecosten/alleluia` | 0.502 / 0.5 | kind; collides: al_omnes_gentes.csv.ly | hold ambiguous identity or melody |
| `al_venite_ad_me.csv.ly` | `part:dominica-viii-post-pentecosten/alleluia` | 0.541 / 0.4 | kind; collides: al_magnus_dominus.csv.ly | hold ambiguous identity or melody |
| `al_verba_mea.csv.ly` | `part:noh2-p133/alleluia` | 0.812 / 0.4 | kind; collides: al_tollite_jugum.csv.ly | hold ambiguous identity or melody |
| `co_petite_cum_alleluia.csv.ly` | `part:noh2-p105/communion` | 0.48 / 0.184 | kind; collides: co_benedicimus_deum.csv.ly | hold ambiguous identity or melody |
| `co_si_quis_sitit.csv.ly` | `part:noh2-p133/communion` | 0.464 / 0.205 | page; collides: co_unus_militum.csv.ly | do not promote melody differs |
| `gr_ego_dixi.csv.ly` | `part:dominica-xxi-post-pentecosten/gradual` | 0.593 / 0.307 | kind | hold ambiguous identity or melody |
| `in_domine_in_tua_misericordia.csv.ly` | `part:dominica-iii-post-pentecosten/introit` | 0.597 / 0.593 | kind; collides: in_respice_in_me.csv.ly | hold ambiguous identity or melody |
| `in_exaudivit.csv.ly` | `part:dominica-xxi-post-pentecosten/introit` | 0.752 / 0.447 | kind; collides: in_in_voluntate.csv.ly | hold ambiguous identity or melody |
| `of_confitebor_domino.csv.ly` | `part:dominica-vii-post-pentecosten/offertory` | 0.597 / 0.123 | kind; collides: of_sicut_in_holocausto.csv.ly | hold ambiguous identity or melody |
| `of_emitte_spiritum.csv.ly` | `part:dominica-xii-post-pentecosten/offertory` | 0.714 / 0.333 | kind; collides: of_precatus_est.csv.ly | hold ambiguous identity or melody |
| `al_beata_es.csv.ly` | `part:pretiosissimi-sanguinis-domini-nostri-jesu-christi/alleluia` | 0.914 / 0.532 | kind; collides: al_si_testimonium.csv.ly | hold ambiguous identity or melody |
| `al_custodi_innocentiam.csv.ly` | `part:s-philippi-neri-confessoris/alleluia` | 0.809 / 0.289 | kind; collides: al_de_excelso.csv.ly | hold ambiguous identity or melody |
| `al_habet_in_vestimento.csv.ly` | `part:s-barnab-apostoli/alleluia` | 0.518 / 0.27 | kind | hold ambiguous identity or melody |
| `al_in_deo_salutare.csv.ly` | `part:s-joannis-leonardi-confessoris/alleluia:paschal` | 0.321 / 0.388 | page; collides: al_sicut_oliva.csv.ly | do not promote melody differs |
| `al_laetamini.csv.ly` | `part:s-bonifatii-episc-et-mart/alleluia` | 0.432 / 0.395 | page | hold ambiguous identity or melody |
| `al_missus_est_angelus.csv.ly` | `part:s-raph-lis-archangeli/alleluia:paschal` | — / — | page | requires scan or direct identity evidence |
| `al_potens_in_terra.csv.ly` | `part:s-joachim-confessoris-patris-b-mari-virginis/alleluia` | — / — | page | requires scan or direct identity evidence |
| `al_potestas_ejus.csv.ly` | `part:s-ignatii-episcopi-et-martyris/alleluia` | 0.546 / 0.407 | kind; collides: al_christo_confixus.csv.ly | hold ambiguous identity or melody |
| `al_qui_ad_justitiam.csv.ly` | `part:s-roberti-bellarmino-episcopi-confessoris-et-ecclesi-doctoris/alleluia` | 0.289 / 0.45 | page | do not promote melody differs |
| `al_quia_factus_es.csv.ly` | `part:s-joannis-a-capistrano-confessoris/alleluia:paschal` | 0.345 / 0.362 | page; collides: al_ego_autem_cantabo.csv.ly | do not promote melody differs |
| `an_lumen_ad_revelationem.2.csv.ly` | `part:s-ignatii-episcopi-et-martyris/communion` | 0.875 / 0.344 | page; collides: an_lumen_ad_revelationem.3.csv.ly, an_lumen_ad_revelationem.4.csv.ly | hold ambiguous identity or melody |
| `an_lumen_ad_revelationem.3.csv.ly` | `part:s-ignatii-episcopi-et-martyris/communion` | 1.0 / 0.25 | page; collides: an_lumen_ad_revelationem.2.csv.ly, an_lumen_ad_revelationem.4.csv.ly | hold ambiguous identity or melody |
| `an_lumen_ad_revelationem.4.csv.ly` | `part:s-ignatii-episcopi-et-martyris/communion` | 0.875 / 0.235 | page; collides: an_lumen_ad_revelationem.2.csv.ly, an_lumen_ad_revelationem.3.csv.ly | hold ambiguous identity or melody |
| `an_lumen_ad_revelationem.5.csv.ly` | `part:s-ignatii-episcopi-et-martyris/communion` | 0.875 / 0.088 | page; collides: an_lumen_ad_revelationem.2.csv.ly, an_lumen_ad_revelationem.3.csv.ly | hold ambiguous identity or melody |
| `an_responsum_accepit.csv.ly` | `part:in-purificatione-beat-mari-virginis/other:4` | 0.387 / 0.188 | page | hold ambiguous identity or melody |
| `co_posuerunt.csv.ly` | `part:s-basilidus/communion` | 0.328 / 0.232 | page | do not promote melody differs |
| `co_quae_est_ista.csv.ly` | `part:s-ambrosii-episcopi-confessoris-et-ecclesi-doctoris/communion` | 0.574 / 0.369 | page | do not promote melody differs |
| `co_regina_mundi_272.csv.ly` | `part:in-commemoratione-beat-mari-virgine-de-monte-carmelo/communion` | 1.0 / 1.0 | kind | strong identity melody but target collision or duplicate candidate |
| `co_sedebit_dominus.csv.ly` | `part:s-agath-virginis-et-martyris/communion` | 0.814 / 0.207 | kind; collides: co_qui_me_dignatus_est.csv.ly | hold ambiguous identity or melody |
| `co_signa_eos.csv.ly` | `part:ss-cyriaci-largi-et-smaragdi-martyrum/communion` | 0.644 / 0.306 | page | hold ambiguous identity or melody |
| `co_vos_estis_lux.csv.ly` | `part:s-petri-chrysologi-episcopi-confessoris-et-ecclesi-doctoris/communion` | 0.841 / 0.242 | kind; collides: co_domine_quinque_talenta.csv.ly | hold ambiguous identity or melody |
| `gr_dominabitur.csv.ly` | `part:in-apparitione-b-mariae-virginis-immaculatae/gradual` | 0.607 / 0.31 | kind; collides: gr_flores_apparuerunt.csv.ly | hold ambiguous identity or melody |
| `in_dignus_est_agnus.csv.ly` | `part:s-bonifatii-episc-et-mart/introit` | 0.688 / 0.387 | kind; collides: in_exsultabo_in_jerusalem.csv.ly | hold ambiguous identity or melody |
| `in_gaudeamus__annae.csv.ly` | `part:s-agath-virginis-et-martyris/introit` | 0.955 / 0.941 | kind; collides: in_gaudeamus__agathae.csv.ly | strong identity melody but target collision or duplicate candidate |
| `in_judicant_sancti.csv.ly` | `part:omnium-sanctorum/introit` | 0.608 / 0.735 | page; collides: in_gaudeamus__sanctorum_omnium.csv.ly | hold ambiguous identity or melody |
| `in_loquetur_dominus.csv.ly` | `part:ss-gervasio-et-protasio/introit` | 0.583 / 0.514 | page | do not promote melody differs |
| `in_probasti.csv.ly` | `part:in-assumptione-beat-mari-virginis/introit` | 0.892 / 0.493 | kind; collides: in_signum_magnum.csv.ly | hold ambiguous identity or melody |
| `in_timete_dominum.csv.ly` | `part:ss-cyriaci-largi-et-smaragdi-martyrum/introit` | 0.454 / 0.483 | page | do not promote melody differs |
| `in_venite_audite.csv.ly` | `part:s-joannis-leonardi-confessoris/introit` | 0.795 / 0.532 | kind; collides: in_in_sermonibus.csv.ly | hold ambiguous identity or melody |
| `of_ego_dilecto.csv.ly` | `part:s-ambrosii-episcopi-confessoris-et-ecclesi-doctoris/offertory` | 0.235 / 0.442 | page | do not promote melody differs |
| `of_postula_a_me.csv.ly` | `part:s-joannis-bosco-confessoris/offertory` | 0.755 / 0.203 | kind; collides: of_venite_filii.csv.ly | hold ambiguous identity or melody |
| `of_venite_filii.csv.ly` | `part:s-joannis-bosco-confessoris/offertory` | 0.975 / 1.0 | kind; collides: of_postula_a_me.csv.ly | strong identity melody but target collision or duplicate candidate |
| `tr_bonum_est_confiteri.csv.ly` | `part:s-gabrielis-archangeli/tract` | 0.872 / 0.249 | kind | hold ambiguous identity or melody |
| `tr_contristatus_sum.csv.ly` | `part:s-joannis-leonardi-confessoris/tract` | — / — | page | requires scan or direct identity evidence |
| `agnus_dei_ad_libitum_II.ly` | `piece:cantus-ad-libitum-agnus-dei-i-ii` | 0.774 / 1.0 | page; collides: agnus_dei_ad_libitum_I.ly | hold ambiguous identity or melody |
| `an_asperges_me__ad_lib3.ly` | `piece:ordinarium-missae-asperges-p4` | — / — | page; collides: an_asperges_me__ad_lib4.ly | requires scan or direct identity evidence |
| `an_asperges_me__ad_lib4.ly` | `piece:ordinarium-missae-asperges-p4` | — / — | page; collides: an_asperges_me__ad_lib3.ly | requires scan or direct identity evidence |
| `gloria_ad_libitum_II.ly` | `movement:ordinarium-missae-xii/gloria` | 0.474 / 0.998 | kind; collides: gloria_XII.ly | hold ambiguous identity or melody |
| `gloria_ad_libitum_III.ly` | `movement:ordinarium-missae-iii/gloria` | 0.307 / 0.998 | kind; collides: gloria_III.ly | hold ambiguous identity or melody |
| `gloria_ad_libitum_IV.ly` | `piece:alii-cantus-ad-libitum-gloria-ambr` | — / — | page | requires scan or direct identity evidence |
| `sanctus_ad_libitum_II.ly` | `piece:cantus-ad-libitum-sanctus-i-iii` | 0.436 / 0.993 | page; collides: sanctus_ad_libitum_I.ly | do not promote melody differs |
| `sanctus_ad_libitum_III.ly` | `movement:ordinarium-missae-viii/sanctus` | 0.655 / 0.993 | kind; collides: sanctus_VIII.ly | hold ambiguous identity or melody |
| `agnus_pro_defunctis.ly` | `movement:ordinarium-missae-ix/agnus` | 0.923 / 0.293 | kind; collides: agnus_IX.ly | hold ambiguous identity or melody |
| `an_ego_sum_resurrectio.ly` | `—` | — / — | none | unresolved target no candidates |
| `an_in_paradisum.ly` | `—` | — / — | none | unresolved target no candidates |
| `ca_benedictus_dominus.ly` | `—` | — / — | none | unresolved target no candidates |
| `kyrie_pro_defunctis.ly` | `movement:ordinarium-missae-ii/kyrie` | 0.788 / 1.0 | kind; collides: kyrie_II.ly | hold ambiguous identity or melody |
| `sanctus_pro_defunctis.ly` | `movement:ordinarium-missae-xviii/sanctus` | 1.0 / 1.0 | kind; collides: sanctus_XVIII.ly | strong identity melody but target collision or duplicate candidate |
| `tonus-solemnis.ly` | `—` | — / — | none | unresolved target no candidates |

## Target collision note

Most collisions are deliberate competition for one printed catalogue part. Examples include four `an_lumen_ad_revelationem` strophes against the Communion target already matched to `co_frumentum`; `in_gaudeamus__annae` against the same target as `in_gaudeamus__agathae`; `of_postula_a_me` and `of_venite_filii` competing for St John Bosco Offertory; and the ad-libitum/Pro Defunctis settings competing with Ordinary Mass movements already assigned to a named Mass source. The per-row JSON records every same-target source and effective correction.

## Printed-page follow-up for the 58 proposed rows

Cross-checking each source page comment through `data/derived-offsets.json` and against `data/catalog.json` page ranges yields these buckets. “Wrongcandidate” means the page is catalogued under another piece than the matcher’s candidate; it does not prove the transcription itself is erroneous. “Targetcollision” means the candidate is also assigned to a currently matched or editor-chosen source. Proposed siblings were not counted as accepted collisions.

| Bucket | Count | Reading |
|---|---:|---|
| Wrong candidate by page mapping | 20 | Candidate slug does not cover the source’s mapped print page; replace the candidate using the printed source page. |
| Target collision with an accepted source | 20 | Candidate page and target are plausible, but a matched/editor-chosen source already owns the target. |
| Genuinely missing printed target/section | 2 | NOH3 p.281 S. Annae Introit; NOH2 p.112 Gradual “Ego dixi.” |
| Potentially exact promotable | 1 | `co_regina_mundi_272.csv.ly` (NOH3 p.272), exact page identity and 1.00 melody/words, no accepted collision. |
| Candidate identity matches page; melody unresolved | 7 | Page ranges fit, but melody/word evidence does not establish agreement. Review as possible musical variants. |
| Page reference unresolved or unmapped | 8 | Missing/out-of-range folio comments or special Kyriale/pro-defunctis cases need direct print identity. |

The row-level JSON includes the printed folio, mapped PDF page, catalogue piece slugs on that page, candidate slug, and bucket for each source.

### Direct scan checks

- `co_regina_mundi_272.csv.ly`: NOH3 PDF page 305 prints folio 272 within the Carmelite feast and shows the Communion “Regina mundi.” It agrees with `part:in-commemoration-beat-mari-virgine-de-monte-carmelo/communion`; source header page iii.456 is stale/inconsistent with the scan and filename `_272`. This is the only confidently identical candidate found without an accepted target collision.
- `in_gaudeamus__annae.csv.ly`: NOH3 PDF page 314 prints folio 281, labels S. Annae, and prints the Gaudeamus Introit. The current proposed target is S. Agatha. Catalog has S. Annae, but its Introit is represented only as borrowed and no printed section target exists. This is a missing printed target, not an Agatha match.
- `gr_ego_dixi.csv.ly`: NOH2 PDF page 144 prints folio 112, with “Grad. V. Ego dixi.” The candidate Dominica XXI is a wrong page identity. The catalog’s printed-page piece `noh2-p110` has no Gradual section; add a section target before assessing this source’s 0.593 melody comparison.

### Prioritized next steps

1. Consider `co_regina_mundi_272.csv.ly` for promotion: scanned identity is explicit, melody and words score 1.00, and no accepted source occupies its target.
2. Correct the missing printed target/section for S. Annae p.281 and the Gradual on NOH2 p.112; then reassess their melody against the corresponding chant.
3. Reassign the 20 wrong-page candidates from their mapped scan pages. Keep the 20 accepted collisions deferred until a source-page review resolves which transcription represents the printed part.
4. Review the seven page-aligned melody cases for genuine variants. Leave the eight unresolved page references out of the promotion batch until their print locations are identified.
