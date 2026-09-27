import pytest

from pipeline.volumes import SOURCE, load_volumes, resolve_source


def test_noh5_volume_is_registered():
    noh5 = load_volumes()["noh5"]
    assert noh5.pdf_pages == 231
    assert noh5.page_offset is None  # derived by pipeline, never hand-set


CCW = "Nova Organi Harmonia - Full PDF.pdf"


def test_registry_is_an_allowlist_not_a_glob():
    """pdf-source/ also holds the 1.16GB Corpus Christi Watershed reference edition,
    which carries burned-in branding and a copyrighted modern preface and must never
    be published. The pipeline reads only what volumes.yml names."""
    registered = {v.file for v in load_volumes().values()}
    assert CCW not in registered, "the CCW reference edition must NOT be registered as a source volume"


@pytest.mark.source
def test_registry_leaves_the_ccw_edition_on_disk_unregistered():
    on_disk = {f.name for f in SOURCE.glob("*.pdf")}
    registered = {v.file for v in load_volumes().values()}
    assert CCW in on_disk - registered


def test_pipeline_refuses_an_unregistered_pdf():
    with pytest.raises(ValueError, match="not in the registry"):
        resolve_source(CCW)


def test_registered_volume_resolves():
    assert resolve_source("NOH5 Kyriale.pdf").name == "NOH5 Kyriale.pdf"
