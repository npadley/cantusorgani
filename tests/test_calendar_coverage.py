"""Every day of the 1962 calendar finds its Mass in the catalogue.

Pure-data checks over data/catalog.json, the reviewed indexes and
data/rubrics-1962.yml. They caught NOH3 filing St Thérèse (3 October) under
8 October, and the papal feasts whose "vide ad calcem Partis IV" was not read."""

import json
import re
from collections import defaultdict
from pathlib import Path

import pytest
import yaml

from pipeline.litcal import load_vocabulary

DATA = Path("data")
PIECES = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))["pieces"]
VOCABULARY = load_vocabulary()
BY_SLUG = {p["slug"]: p for p in PIECES}

# Days of class I-III that NOH has no Mass for, and why. Nothing else may go
# missing: a new gap is a catalogue error until it is explained here.
NOT_IN_NOH = {
    "tempora:Quad6-5r": "Good Friday: the organ is silent from Holy Thursday to the Vigil",
    "sancti:05-01r": "St Joseph the Worker, instituted 1955: NOH3's addenda print only the two 1954 feasts",
    "sancti:06-17r": "St Gregory Barbarigo, canonised 1960: after NOH was printed",
    "sancti:07-21r": "St Lawrence of Brindisi, added 1959: after NOH was printed",
    "sancti:10-23r": "St Anthony Mary Claret, canonised 1950: after NOH was printed",
}


def own_mass_days() -> set[str]:
    return {k for k, v in VOCABULARY.items()
            if int(str(v["rank"])) <= 3 and not k.endswith("c")}


def test_every_1962_day_with_its_own_mass_has_a_proper():
    catalogued = {d for p in PIECES for d in p["days"]}
    missing = sorted(own_mass_days() - catalogued - set(NOT_IN_NOH))
    assert missing == [], f"no Proper for {[(k, VOCABULARY[k]['title_la']) for k in missing]}"


def test_every_explained_gap_is_still_a_gap():
    """When one of these is catalogued, take it off the list."""
    catalogued = {d for p in PIECES for d in p["days"]}
    assert sorted(set(NOT_IN_NOH) & catalogued) == []
    assert set(NOT_IN_NOH) <= set(VOCABULARY)


def _indexes() -> list[dict[str, object]]:
    return [yaml.safe_load(p.read_text(encoding="utf-8"))
            for p in sorted(DATA.glob("index-noh*.yml")) if not p.name.endswith(".proposed.yml")]


def test_no_feast_takes_two_whole_masses():
    """A feast's Mass is printed in the Proper of Saints or named by one rubric
    ("Missa. Os justi, Pars IV, p. 76"), never both: two sources for one day
    means one of them is filed under the wrong day. Partial references
    ("Introitus. Benedicite, ut supra") borrow a part and are not counted."""
    sources: dict[str, list[str]] = defaultdict(list)
    for doc in _indexes():
        for section in doc.get("sections") or []:
            if section["division"] != "sanctorale":
                continue
            for e in section["entries"]:
                for day in e.get("days") or []:
                    sources[day].append(f"{doc['volume']} p. {e['page']} {e['title']}")
        for r in doc.get("rubrics") or []:
            if re.match(r"\W*M\S{0,2}ssa\b", str(r.get("reference", ""))):
                for day in r.get("days") or []:
                    sources[day].append(f"{doc['volume']} p. {r['page']} rubric {r['title']}")
    doubled = {day: s for day, s in sources.items() if len(s) > 1}
    assert doubled == {}


@pytest.mark.parametrize(("slug", "day"), [
    ("s-theresiae-a-jesu-infante-virginis", "sancti:10-03"),        # heading OCR'd "2, 8 Octobris"
    ("s-mariae-magdalenae-poenitentis", "sancti:07-22"),            # heading OCR'd "2 Julii"
    ("ss-philippi-et-jacobi-apostolorum", "sancti:05-11r"),         # 1 May in 1942
    ("s-irenaei-episcopi-et-martyris", "sancti:07-03r"),            # 28 June in 1942
    ("in-apparitione-b-mariae-virginis-immaculatae", "sancti:02-11"),  # had no entry at all
    ("feria-vi-infra-hebd-passionis", "tempora:Quad5-5Feria"),
])
def test_feasts_found_on_the_wrong_day_stay_on_the_right_one(slug, day):
    assert day in BY_SLUG[slug]["days"]
    assert day not in BY_SLUG[slug]["linked_days"]


@pytest.mark.parametrize(("slug", "day"), [
    ("in-dedicatione-s-mich-lis-archangelis", "sancti:10-02"),      # not SS Cosmas and Damian's heading
    ("ss-quadraginta-martyrum", "sancti:11-10o"),                   # not St Frances of Rome's heading
    ("commune-unius-aut-plurium-summorum-pontificum", "sancti:10-14"),  # "vide ad calcem Partis IV"
    ("commune-confessoris-non-pontificis", "sancti:03-04"),         # "Pars iV, p. 76"
    ("dominica-i-adventus", "tempora:Adv1-3"),                      # rubrics-1962.yml
    ("missa-pro-defunctis-i", "sancti:11-02m1"),
])
def test_borrowed_masses_link_to_the_mass_they_name(slug, day):
    assert day in BY_SLUG[slug]["linked_days"]


def test_1942_feasts_the_1962_calendar_dropped_claim_no_day():
    """The octave of St Lawrence once sat on 17 August; 1962 keeps St Hyacinth
    there. A dropped feast keeps its page but claims no 1962 day."""
    for slug in ("in-octava-s-laurentii-martyris", "in-octava-omnium-sanctorum",
                 "in-inventione-s-crucis", "s-petri-ad-vincula", "in-vigilia-s-andreae-apostoli"):
        assert BY_SLUG[slug]["days"] == [], slug
