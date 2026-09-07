from pipeline.references import load_references, reference_filenames
from pipeline.volumes import load_volumes


def test_ccw_edition_is_registered_as_a_reference():
    refs = load_references()
    assert "ccw" in refs
    assert refs["ccw"].pdf_pages == 2201
    assert "branding" in refs["ccw"].excluded_reason


def test_reference_ids_are_counted_once():
    """load_references is keyed by id only; double-keying it by filename too would
    silently double every count derived from it."""
    assert len(load_references()) == len(reference_filenames()) == 1


def test_no_reference_edition_is_also_a_publication_source():
    """The guard that keeps CCW branding and its copyrighted preface off the site."""
    registered = {v.file for v in load_volumes().values()}
    assert registered & reference_filenames() == set()
