# Hymn chant research — 2026-10-03

The 129 complete printed settings in the Hymns index now all have source-specific research: 127 verified setting identities, one related candidate (Auctor beate saeculi), and one unresolved hymn (O amator castitatis, S. Rumoldi). The damaged En ut superba fragment has a separate candidate record and remains outside the complete-settings index. Book I’s previously reviewed Benedictus es pairing is retained; its two borrowed occurrences continue to link to the same printed source.

## What verified means

The printed words, mode/usage, and soprano opening (normally the first two phrases) were compared with primary GregoBase GABC. Relative intervals allow transposed organ accompaniments. This identifies the chant setting/melody family; it is not an exhaustive proof of every note or stanza. Different tones and similarly named hymns were compared separately. Full-page checks confirmed all Book VIII hymn anchors; 22 Book VII starts were corrected to exclude preceding responses or doxologies. The immutable published image assets did not change.

The reviewed input is `data/hymn-pairings.yml`, keyed by actual owned source reference. `noh chants` validates ownership and hymn starts, regenerates `data/hymn-pairings.json`, and publishes notation only for verified matches with an explicit non-copyrighted flag. Uncertain links never become notation for that setting. Source-specific evidence and rejected alternatives are preserved in the adjacent research JSON.

## Primary sources and reproducibility

Most chants come from the pinned GregoBase SQL dump (SHA-256 `3759c60b529b57fa13f696bfacf748d40a285a847d859276667749caa76de080`). Eight newer primary entries are preserved byte-for-byte, with source/download URLs, retrieval dates and hashes, in `data/hymn-chant-sources.json`. Those newer entries lack an explicit copyright flag in their primary page/download metadata, so their confirmed matches are links only; their notation is not included in the site’s published chant bundle.

## Exceptions

- **Auctor beate saeculi:** 18256 is relevant text/mode, but its opening melody does not establish a match to this accompaniment. It is labelled as needing review.
- **En ut superba:** candidate 2335; the source survives only as a composite-page fragment. No verified complete setting or chant notation is claimed.
- **O amator castitatis (S. Rumoldi):** no supported match after checking the pinned dump, current primary index, and plausible common-tune contours. No substitute was forced.
- **O Crux ave:** verified 12999, stanza 6, with both Paschale quae fers gaudium and In hac triumphi gloria. The seasonal verses appear in the pinned SQL’s `gabc_verses` and the current primary download. The link opens the containing Vexilla regis chant.
- **Ad regias Agni dapes, alternate tone:** the source’s printed VIII indication differs from GregoBase 2473’s IV label; opening notes/text support the selected melody. The printed rubric is preserved.
- **Jesu corona, alternate II (19359):** opening melody and text identity match, but the raw primary transcription contains spelling errors, including Virginem for Virginum. Those errors are preserved rather than silently corrected; follow the book’s printed text. Its source permission flag is unknown and the site provides a link only.

## Source-specific results

| Source | Setting | GregoBase | Review |
|---|---|---|---|
| noh1/0057/002 | Benedictus es | [1589](https://gregobase.selapa.net/chant.php?id=1589) | verified |
| noh7/0040/000 | Creator alme siderum | [2134](https://gregobase.selapa.net/chant.php?id=2134) | verified |
| noh7/0041/004 | Jesu Redemptor omnium | [3001](https://gregobase.selapa.net/chant.php?id=3001) | verified |
| noh7/0043/002 | Deus tuorum militum (pro S. Stephano) | [2126](https://gregobase.selapa.net/chant.php?id=2126) | verified |
| noh7/0045/000 | Exsultet orbis gaudiis (pro S. Joanne Evangelista) | [2191](https://gregobase.selapa.net/chant.php?id=2191) | verified |
| noh7/0046/003 | Salvete flores Martyrum | [1963](https://gregobase.selapa.net/chant.php?id=1963) | verified |
| noh7/0048/000 | Jesu dulcis memoria | [1911](https://gregobase.selapa.net/chant.php?id=1911) | verified |
| noh7/0053/002 | Crudelis Herodes | [2129](https://gregobase.selapa.net/chant.php?id=2129) | verified |
| noh7/0055/000 | Crudelis Herodes (alter tonus) | [1825](https://gregobase.selapa.net/chant.php?id=1825) | verified |
| noh7/0056/003 | O lux beata Caelitum | [2224](https://gregobase.selapa.net/chant.php?id=2224) | verified |
| noh7/0058/003 | Audi benigne Conditor | [1830](https://gregobase.selapa.net/chant.php?id=1830) | verified |
| noh7/0060/000 | Vexilla Regis prodeunt (Qua vita) | [2120](https://gregobase.selapa.net/chant.php?id=2120) | verified |
| noh7/0065/000 | Ad regias Agni dapes | [2932](https://gregobase.selapa.net/chant.php?id=2932) | verified |
| noh7/0067/000 | Ad regias Agni dapes (alter tonus) | [2473](https://gregobase.selapa.net/chant.php?id=2473) | verified |
| noh7/0076/000 | Salutis humanae Sator | [1288](https://gregobase.selapa.net/chant.php?id=1288) | verified |
| noh7/0080/003 | Veni Creator Spiritus | [2923](https://gregobase.selapa.net/chant.php?id=2923) | verified |
| noh7/0082/000 | Jam sol recedit | [2018](https://gregobase.selapa.net/chant.php?id=2018) | verified |
| noh7/0083/002 | Lucis Creator optime | [2014](https://gregobase.selapa.net/chant.php?id=2014) | verified |
| noh7/0092/000 | Pange lingua gloriosi Corporis | [1310](https://gregobase.selapa.net/chant.php?id=1310) | verified |
| noh7/0093/004 | Pange lingua gloriosi Corporis (alter tonus) | [2888](https://gregobase.selapa.net/chant.php?id=2888) | verified |
| noh7/0095/003 | Sacris solemniis | [2274](https://gregobase.selapa.net/chant.php?id=2274) | verified |
| noh7/0097/002 | Sacris solemniis (alter tonus) | [1917](https://gregobase.selapa.net/chant.php?id=1917) | verified |
| noh7/0099/000 | Verbum supernum | [53](https://gregobase.selapa.net/chant.php?id=53) | verified |
| noh7/0100/000 | Aeterne Rex altissime | [2092](https://gregobase.selapa.net/chant.php?id=2092) | verified |
| noh7/0101/002 | En ut superba criminum | [2335](https://gregobase.selapa.net/chant.php?id=2335) | unverified |
| noh7/0102/003 | Auctor beate saeculi | [18256](https://gregobase.selapa.net/chant.php?id=18256) | unverified |
| noh7/0108/000 | Exsultet orbis gaudiis | [2194](https://gregobase.selapa.net/chant.php?id=2194) | verified |
| noh7/0109/002 | Exsultet orbis gaudiis (alter tonus) | [2351](https://gregobase.selapa.net/chant.php?id=2351) | verified |
| noh7/0111/003 | Deus tuorum militum | [2702](https://gregobase.selapa.net/chant.php?id=2702) | verified |
| noh7/0113/001 | Tristes erant Apostoli | [2295](https://gregobase.selapa.net/chant.php?id=2295) | verified |
| noh7/0115/003 | Deus tuorum militum (tempore paschali) | [12553](https://gregobase.selapa.net/chant.php?id=12553) | verified |
| noh7/0117/004 | Rex gloriose Martyrum | [2790](https://gregobase.selapa.net/chant.php?id=2790) | verified |
| noh7/0120/000 | Sanctorum meritis inclyta | [2571](https://gregobase.selapa.net/chant.php?id=2571) | verified |
| noh7/0123/000 | Iste Confessor | [2334](https://gregobase.selapa.net/chant.php?id=2334) | verified |
| noh7/0124/003 | Iste Confessor (alius tonus 4) | [2417](https://gregobase.selapa.net/chant.php?id=2417) | verified |
| noh7/0127/000 | Iste Confessor (alius tonus 5) | [2407](https://gregobase.selapa.net/chant.php?id=2407) | verified |
| noh7/0128/004 | Iste Confessor (alius tonus 7) | [18629](https://gregobase.selapa.net/chant.php?id=18629) | verified |
| noh7/0131/000 | Jesu corona Virginum | [18189](https://gregobase.selapa.net/chant.php?id=18189) | verified |
| noh7/0132/001 | Jesu corona Virginum (tempore paschali) | [2143](https://gregobase.selapa.net/chant.php?id=2143) | verified |
| noh7/0134/002 | Fortem virili pectore | [2492](https://gregobase.selapa.net/chant.php?id=2492) | verified |
| noh7/0136/002 | Caelestis urbs Jerusalem | [2200](https://gregobase.selapa.net/chant.php?id=2200) | verified |
| noh7/0139/000 | Ave maris stella | [2232](https://gregobase.selapa.net/chant.php?id=2232) | verified |
| noh7/0140/001 | Ave maris stella (alius tonus) | [2563](https://gregobase.selapa.net/chant.php?id=2563) | verified |
| noh7/0143/000 | Te Joseph celebrent | [2235](https://gregobase.selapa.net/chant.php?id=2235) | verified |
| noh7/0151/000 | O Crux ave | [12999](https://gregobase.selapa.net/chant.php?id=12999) | verified |
| noh7/0153/000 | Ut queant laxis | [2539](https://gregobase.selapa.net/chant.php?id=2539) | verified |
| noh7/0155/000 | Decora lux aeternitatis | [2761](https://gregobase.selapa.net/chant.php?id=2761) | verified |
| noh7/0157/000 | Decora lux aeternitatis (alter tonus) | [2111](https://gregobase.selapa.net/chant.php?id=2111) | verified |
| noh7/0159/000 | Festivis resonent compita | [2839](https://gregobase.selapa.net/chant.php?id=2839) | verified |
| noh7/0162/002 | Quicumque Christum quaeritis | [2309](https://gregobase.selapa.net/chant.php?id=2309) | verified |
| noh7/0165/000 | O quot undis lacrimarum | [4095](https://gregobase.selapa.net/chant.php?id=4095) | verified |
| noh7/0172/000 | Te splendor et virtus | [2460](https://gregobase.selapa.net/chant.php?id=2460) | verified |
| noh7/0174/000 | Caelestis aulae Nuntius | [2615](https://gregobase.selapa.net/chant.php?id=2615) | verified |
| noh7/0175/003 | Te gestientem gaudiis | [2698](https://gregobase.selapa.net/chant.php?id=2698) | verified |
| noh7/0177/002 | Te saeculorum Principem | [2654](https://gregobase.selapa.net/chant.php?id=2654) | verified |
| noh7/0179/002 | Placare Christe servulis | [2829](https://gregobase.selapa.net/chant.php?id=2829) | verified |
| noh7/0195/003 | Ecce panis Angelorum | [3342](https://gregobase.selapa.net/chant.php?id=3342) | verified |
| noh7/0197/001 | Panis angelicus | [3334](https://gregobase.selapa.net/chant.php?id=3334) | verified |
| noh7/0198/001 | Panis angelicus (alter tonus) | [3037](https://gregobase.selapa.net/chant.php?id=3037) | verified |
| noh7/0199/001 | O salutaris Hostia | [3034](https://gregobase.selapa.net/chant.php?id=3034) | verified |
| noh7/0200/000 | Ave verum | [2441](https://gregobase.selapa.net/chant.php?id=2441) | verified |
| noh7/0201/000 | Adoro te | [3020](https://gregobase.selapa.net/chant.php?id=3020) | verified |
| noh7/0211/003 | Tantum ergo | [2176](https://gregobase.selapa.net/chant.php?id=2176) | verified |
| noh7/0212/003 | Tantum ergo (alio modo) | [3994](https://gregobase.selapa.net/chant.php?id=3994) | verified |
| noh7/0236/000 | Quem terra pontus | [17043](https://gregobase.selapa.net/chant.php?id=17043) | verified |
| noh7/0237/001 | O gloriosa Virginum | [2885](https://gregobase.selapa.net/chant.php?id=2885) | verified |
| noh7/0240/003 | Stabat Mater dolorosa (hymnus) | [2163](https://gregobase.selapa.net/chant.php?id=2163) | verified |
| noh7/0253/003 | Adeste fideles | [7660](https://gregobase.selapa.net/chant.php?id=7660) | verified |
| noh7/0261/002 | Salve festa dies | [8241](https://gregobase.selapa.net/chant.php?id=8241) | verified |
| noh7/0264/000 | O filii et filiae | [3031](https://gregobase.selapa.net/chant.php?id=3031) | verified |
| noh7/0268/002 | O amator castitatis (S. Rumoldi) | — | unresolved |
| noh8/0051/004 | Lucis Creator optime | [2014](https://gregobase.selapa.net/chant.php?id=2014) | verified |
| noh8/0053/002 | Lucis Creator optime (alius tonus) | [2432](https://gregobase.selapa.net/chant.php?id=2432) | verified |
| noh8/0054/002 | Lucis Creator optime (alius tonus) | [2095](https://gregobase.selapa.net/chant.php?id=2095) | verified |
| noh8/0059/000 | Te lucis ante terminum | [13354](https://gregobase.selapa.net/chant.php?id=13354) | verified |
| noh8/0060/000 | Te lucis ante terminum (alius tonus) | [1843](https://gregobase.selapa.net/chant.php?id=1843) | verified |
| noh8/0061/000 | Te lucis ante terminum (alius tonus) | [2998](https://gregobase.selapa.net/chant.php?id=2998) | verified |
| noh8/0062/000 | Te lucis ante terminum (alius tonus) | [1845](https://gregobase.selapa.net/chant.php?id=1845) | verified |
| noh8/0063/000 | Te lucis ante terminum (alius tonus) | [11857](https://gregobase.selapa.net/chant.php?id=11857) | verified |
| noh8/0081/001 | Creator alme siderum | [2134](https://gregobase.selapa.net/chant.php?id=2134) | verified |
| noh8/0100/004 | Jesu Redemptor omnium | [3001](https://gregobase.selapa.net/chant.php?id=3001) | verified |
| noh8/0108/000 | Deus tuorum militum (S. Stephani) | [2126](https://gregobase.selapa.net/chant.php?id=2126) | verified |
| noh8/0118/002 | Jesu dulcis memoria | [1911](https://gregobase.selapa.net/chant.php?id=1911) | verified |
| noh8/0123/003 | Crudelis Herodes | [2129](https://gregobase.selapa.net/chant.php?id=2129) | verified |
| noh8/0124/004 | Crudelis Herodes (alter tonus) | [1825](https://gregobase.selapa.net/chant.php?id=1825) | verified |
| noh8/0130/000 | O lux beata Caelitum | [2224](https://gregobase.selapa.net/chant.php?id=2224) | verified |
| noh8/0139/003 | Audi benigne Conditor | [1830](https://gregobase.selapa.net/chant.php?id=1830) | verified |
| noh8/0143/003 | Vexilla Regis prodeunt | [2120](https://gregobase.selapa.net/chant.php?id=2120) | verified |
| noh8/0150/000 | Ad regias Agni dapes | [2932](https://gregobase.selapa.net/chant.php?id=2932) | verified |
| noh8/0152/000 | Ad regias Agni dapes (alter tonus) | [2473](https://gregobase.selapa.net/chant.php?id=2473) | verified |
| noh8/0159/000 | Salutis humanae Sator | [2828](https://gregobase.selapa.net/chant.php?id=2828) | verified |
| noh8/0165/000 | Veni Creator Spiritus | [2923](https://gregobase.selapa.net/chant.php?id=2923) | verified |
| noh8/0172/003 | Jam sol recedit | [2018](https://gregobase.selapa.net/chant.php?id=2018) | verified |
| noh8/0178/000 | Pange lingua gloriosi Corporis | [1310](https://gregobase.selapa.net/chant.php?id=1310) | verified |
| noh8/0184/002 | En ut superba | [2335](https://gregobase.selapa.net/chant.php?id=2335) | verified |
| noh8/0204/000 | Ave maris stella | [2232](https://gregobase.selapa.net/chant.php?id=2232) | verified |
| noh8/0212/002 | Te Joseph celebrent | [2235](https://gregobase.selapa.net/chant.php?id=2235) | verified |
| noh8/0226/000 | Ut queant laxis | [2539](https://gregobase.selapa.net/chant.php?id=2539) | verified |
| noh8/0232/000 | Decora lux aeternitatis | [2761](https://gregobase.selapa.net/chant.php?id=2761) | verified |
| noh8/0233/003 | Decora lux aeternitatis (alter tonus) | [2111](https://gregobase.selapa.net/chant.php?id=2111) | verified |
| noh8/0238/004 | Festivis resonent | [2839](https://gregobase.selapa.net/chant.php?id=2839) | verified |
| noh8/0247/002 | Te saeculorum Principem | [2654](https://gregobase.selapa.net/chant.php?id=2654) | verified |
| noh8/0252/004 | Placare Christe servulis | [2829](https://gregobase.selapa.net/chant.php?id=2829) | verified |
| noh8/0258/002 | Exsultet orbis gaudiis | [2194](https://gregobase.selapa.net/chant.php?id=2194) | verified |
| noh8/0259/003 | Exsultet orbis gaudiis (alter tonus) | [2351](https://gregobase.selapa.net/chant.php?id=2351) | verified |
| noh8/0266/000 | Deus tuorum militum, extra Tempus Paschale | [2702](https://gregobase.selapa.net/chant.php?id=2702) | verified |
| noh8/0267/000 | Deus tuorum militum (alter tonus) | [2789](https://gregobase.selapa.net/chant.php?id=2789) | verified |
| noh8/0273/000 | Deus tuorum militum, Tempore Paschali | [12833](https://gregobase.selapa.net/chant.php?id=12833) | verified |
| noh8/0274/000 | Deus tuorum militum, Tempore Paschali (alter tonus) | [12553](https://gregobase.selapa.net/chant.php?id=12553) | verified |
| noh8/0275/002 | Rex gloriose Martyrum | [13113](https://gregobase.selapa.net/chant.php?id=13113) | verified |
| noh8/0276/002 | Rex gloriose Martyrum (alter tonus) | [12168](https://gregobase.selapa.net/chant.php?id=12168) | verified |
| noh8/0282/000 | Sanctorum meritis | [2571](https://gregobase.selapa.net/chant.php?id=2571) | verified |
| noh8/0284/000 | Sanctorum meritis (alter tonus) | [2026](https://gregobase.selapa.net/chant.php?id=2026) | verified |
| noh8/0292/003 | Iste Confessor, Conf. Pont. | [18951](https://gregobase.selapa.net/chant.php?id=18951) | verified (link only) |
| noh8/0294/000 | Iste Confessor, Conf. Pont. (alius tonus) | [18952](https://gregobase.selapa.net/chant.php?id=18952) | verified (link only) |
| noh8/0295/002 | Iste Confessor, Conf. Pont. (alius tonus) | [18953](https://gregobase.selapa.net/chant.php?id=18953) | verified (link only) |
| noh8/0296/004 | Iste Confessor, Conf. Pont. (alius tonus) | [18948](https://gregobase.selapa.net/chant.php?id=18948) | verified (link only) |
| noh8/0305/000 | Iste Confessor, Conf. non Pont. | [18950](https://gregobase.selapa.net/chant.php?id=18950) | verified (link only) |
| noh8/0306/002 | Iste Confessor, Conf. non Pont. (alius tonus) | [18949](https://gregobase.selapa.net/chant.php?id=18949) | verified (link only) |
| noh8/0307/004 | Iste Confessor, Conf. non Pont. (alius tonus) | [18629](https://gregobase.selapa.net/chant.php?id=18629) | verified |
| noh8/0309/001 | Iste Confessor, Conf. non Pont. (alius tonus) | [18947](https://gregobase.selapa.net/chant.php?id=18947) | verified (link only) |
| noh8/0315/001 | Jesu corona Virginum, extra Tempus Paschale | [2587](https://gregobase.selapa.net/chant.php?id=2587) | verified |
| noh8/0316/002 | Jesu corona Virginum (alter tonus) | [19359](https://gregobase.selapa.net/chant.php?id=19359) | verified (link only) |
| noh8/0317/003 | Jesu corona Virginum, Tempore Paschali | [2143](https://gregobase.selapa.net/chant.php?id=2143) | verified |
| noh8/0323/003 | Fortem virili pectore, extra Tempus Paschale | [2492](https://gregobase.selapa.net/chant.php?id=2492) | verified |
| noh8/0324/004 | Fortem virili pectore, Tempore Paschali | [2024](https://gregobase.selapa.net/chant.php?id=2024) | verified |
| noh8/0331/000 | Caelestis urbs Jerusalem | [2200](https://gregobase.selapa.net/chant.php?id=2200) | verified |
| noh8/0338/000 | Ave maris stella (alius tonus) | [2232](https://gregobase.selapa.net/chant.php?id=2232) | verified |
| noh8/0339/001 | Ave maris stella (alius tonus) | [2563](https://gregobase.selapa.net/chant.php?id=2563) | verified |
| noh8/0340/002 | Ave maris stella (alius tonus) | [1900](https://gregobase.selapa.net/chant.php?id=1900) | verified |
