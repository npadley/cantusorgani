"""Reviewed Book VII starts override headings absent from its composite scan."""
from pipeline.index import load_index
from pipeline.catalog import start_system
from pipeline.catalog import has_parts
from pipeline.index import IndexEntry
import json
from pipeline.volumes import DATA
import pytest

@pytest.mark.parametrize('slug,ref', [
    ('varia-audi-benigne-conditor','noh7/0058/003'),
    ('varia-lucis-creator-optime','noh7/0083/002'),
    ('varia-deus-tuorum-militum','noh7/0111/003'),
    ('varia-deus-tuorum-militum-tempore-paschali','noh7/0115/003'),
    ('varia-fortem-virili-pectore','noh7/0134/002'),
    ('varia-caelestis-urbs-jerusalem','noh7/0136/002'),
    ('varia-ecce-panis-angelorum','noh7/0195/003'),
    ('varia-adeste-fideles','noh7/0253/003'),
    ('varia-salvete-flores-martyrum','noh7/0046/003'),
    ('varia-tristes-erant-apostoli','noh7/0113/001'),
    ('varia-quicumque-christum-quaeritis','noh7/0162/002'),
    ('varia-te-saeculorum-principem','noh7/0177/002'),
    ('varia-placare-christe-servulis','noh7/0179/002'),
    ('varia-panis-angelicus','noh7/0197/001'),
    ('varia-panis-angelicus-alter-tonus','noh7/0198/001'),
    ('varia-o-salutaris-hostia','noh7/0199/001'),
    ('varia-tantum-ergo','noh7/0211/003'),
    ('varia-tantum-ergo-alio-modo','noh7/0212/003'),
    ('varia-o-gloriosa-virginum','noh7/0237/001'),
    ('varia-stabat-mater-dolorosa-hymnus','noh7/0240/003'),
    ('varia-salve-festa-dies','noh7/0261/002'),
    ('varia-o-amator-castitatis-s-rumoldi','noh7/0268/002'),
])
def test_hymn_starts_after_the_preceding_response(slug,ref):
    pieces=json.loads((DATA/'catalog.json').read_text())['pieces']
    assert next(p for p in pieces if p['slug']==slug)['systems'][0] == ref


def test_reviewed_start_and_source_note_are_read_from_the_index(tmp_path):
    path = tmp_path / "index.yml"
    path.write_text("""sections:
- name: Hymni
  division: varia
  entries:
  - {slug: damaged, label: En ut, title: En ut, genre: hymn, page: 70,
     first_system: 2, source_note: 'Only a fragment of printed page 72 survives.'}
""")
    e = load_index("noh7", path)[0]
    assert e.first_system == 2
    assert e.source_note == "Only a fragment of printed page 72 survives."
    assert start_system("noh7", None, e, 5) == 2


def test_varia_hymns_are_not_divided_into_mass_propers():
    def entry(genre):
        return IndexEntry("test", "Varia", "test", "test", genre, 1, None, None, division="varia")
    assert not has_parts(entry("hymn"))
    assert not has_parts(entry("litany"))
    assert has_parts(entry("proper"))
    assert has_parts(entry("requiem"))


@pytest.mark.source
def test_composite_page_preserves_the_two_top_systems_and_fragment():
    from pipeline.evaluate import analyse_page
    a = analyse_page("noh7", 101)
    assert a.system_count == 6
    assert a.boxes[0].top < 500
    assert a.boxes[1].bottom < 1400
    assert a.boxes[2].top > 1600


@pytest.mark.source
def test_creator_alme_first_slice_includes_both_staves():
    from pipeline.evaluate import analyse_page
    a = analyse_page("noh7", 40)
    assert len(a.staves) == 8
    assert a.boxes[0].top < 820  # all three printed stanzas, not only the staves
    assert a.boxes[1].top < 1460


@pytest.mark.source
@pytest.mark.parametrize('page,count', [(146,6),(152,5),(156,5),(204,6),(210,6),(232,6),(238,6),(254,6),(258,6)])
def test_reviewed_faint_pages_preserve_every_braced_staff(page, count):
    from pipeline.evaluate import analyse_page
    a = analyse_page('noh7', page)
    assert a.system_count == count
    assert len(a.staves) == count * 2
    assert all(s.staff_count == 2 for s in a.systems)
