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
    if CCW not in on_disk:
        pytest.skip("the CCW edition is only on the maintainer's machine (never in git)")
    registered = {v.file for v in load_volumes().values()}
    assert CCW in on_disk - registered


def test_git_tracks_only_the_noh_scans_in_pdf_source():
    """The NOH volumes are public domain and in git; the CCW reference edition,
    beside them on the maintainer's machine, must never be (.gitignore)."""
    import subprocess
    tracked = subprocess.run(["git", "ls-files", "pdf-source"], cwd=SOURCE.parent, capture_output=True,
                             text=True, check=True).stdout.splitlines()
    names = [t.removeprefix("pdf-source/") for t in tracked]
    assert CCW not in names
    assert all(n.startswith("NOH") and n.endswith(".pdf") and "/" not in n for n in names), names


def test_pipeline_refuses_an_unregistered_pdf():
    with pytest.raises(ValueError, match="not in the registry"):
        resolve_source(CCW)


def test_registered_volume_resolves():
    assert resolve_source("NOH5 Kyriale.pdf").name == "NOH5 Kyriale.pdf"


def test_staff_finder_refuses_an_unknown_setting_or_a_page_named_twice(tmp_path) -> None:
    import pytest
    base = {"title": "t", "part": "I", "file": "f.pdf", "pdf_pages": 9, "index_pdf_pages": [],
            "first_body_pdf_page": 1, "page_offset": None, "sha256": None, "source_url": None,
            "retrieved": None, "provenance": None}
    import yaml
    for finder, message in (({"tilted": [3]}, "the settings are"),
                            ({"refit": [3], "plain": [3]}, "names a page twice")):
        path = tmp_path / "volumes.yml"
        path.write_text(yaml.safe_dump({"volumes": {"nohx": {**base, "staff_finder": finder}}}))
        with pytest.raises(ValueError, match=message):
            load_volumes(path)
    path.write_text(yaml.safe_dump({"volumes": {"nohx": {**base, "staff_finder": {"plain": [4], "refit": [3]}}}}))
    assert load_volumes(path)["nohx"].staff_finder == (("refit", (3,)), ("plain", (4,)))
    path.write_text(yaml.safe_dump({"volumes": {"nohx": {**base, "staff_finder": {"faint": [5]}}}}))
    assert load_volumes(path)["nohx"].staff_finder == (("faint", (5,)),)
