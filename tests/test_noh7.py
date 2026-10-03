"""Reviewed Book VII starts override headings absent from its composite scan."""
from pipeline.index import load_index
from pipeline.catalog import start_system
from pipeline.catalog import has_parts
from pipeline.index import IndexEntry
import pytest


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
