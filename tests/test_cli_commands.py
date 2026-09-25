"""Every `noh` verb, run through main() against the real source volume.

Verbs that would overwrite committed data (offset, catalog) have their output
path redirected into tmp_path; the work itself runs unmodified.
"""

import functools
import json

import pytest

from pipeline import cli
from pipeline import offset as offset_mod

pytestmark = [pytest.mark.source, pytest.mark.slow]


@pytest.fixture
def fake_r2_env(monkeypatch):
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.setenv(name, "test-value")


def test_main_doctor_returns_zero_when_everything_needed_is_present(capsys):
    assert cli.main(["doctor"]) == 0
    assert "tesseract" in capsys.readouterr().out


def test_main_render_writes_the_requested_page(tmp_path, capsys):
    assert cli.main(["render", "--volume", "noh5", "--pages", "229", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "0229.png").exists()
    assert "[1/1]" in capsys.readouterr().out


def test_main_folio_reports_agreement_per_page(capsys):
    assert cli.main(["folio", "--volume", "noh5", "--pages", "229"]) == 0
    out = capsys.readouterr().out
    assert "folio=183" in out and out.startswith("ok")


def test_main_head_matches_the_running_head_to_a_section(capsys):
    assert cli.main(["head", "--volume", "noh5", "--pages", "144"]) == 0
    assert "section=Credo I" in capsys.readouterr().out


def test_main_index_lists_every_entry_with_its_range(capsys):
    assert cli.main(["index", "--volume", "noh5"]) == 0
    out = capsys.readouterr().out
    assert "ordinarium-missae-i " in out and "pp.5-10" in out
    assert len(out.strip().splitlines()) == 46


def test_main_crosscheck_exits_zero_with_no_offset_mismatches(capsys):
    assert cli.main(["crosscheck", "--volume", "noh5"]) == 0
    assert "mismatch=0" in capsys.readouterr().out


def test_main_offset_persists_the_derived_value(tmp_path, monkeypatch, capsys):
    store = tmp_path / "offsets.json"
    monkeypatch.setattr(offset_mod, "persist",
                        functools.partial(offset_mod.persist, path=store))
    # 25 samples, as the real run uses: on a random sample only ~50-64% of pages
    # yield an agreed folio, and fewer than 10 agreed readings is refused by design.
    assert cli.main(["offset", "--volume", "noh5", "--sample-size", "25"]) == 0
    assert json.loads(store.read_text())["noh5"]["offset"] == 46
    assert "offset +46" in capsys.readouterr().out


def test_main_publish_without_upload_slices_only(tmp_path, capsys):
    assert cli.main(["publish", "--volume", "noh5", "--pages", "229", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "0229" / "000@2x.png").exists()
    assert "5 systems sliced" in capsys.readouterr().out


def test_main_publish_dry_run_says_would_upload_and_sends_nothing(tmp_path, fake_r2_env, capsys):
    """A report claiming an upload that never left the machine is the same class
    of lie as a migration reporting success while dropping its own table."""
    code = cli.main(["publish", "--volume", "noh5", "--pages", "229", "--out", str(tmp_path),
                     "--upload", "--dry-run"])
    out = capsys.readouterr().out
    assert code == 0
    assert "would upload 15" in out
    assert "nothing was sent" in out


def test_main_publish_upload_without_credentials_fails_before_slicing(tmp_path, monkeypatch):
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match="missing R2 credentials"):
        cli.main(["publish", "--volume", "noh5", "--pages", "229", "--out", str(tmp_path),
                  "--upload"])
    assert not (tmp_path / "0229").exists(), "must fail before doing any work"


def test_main_overlay_writes_page_and_sheet(capsys):
    assert cli.main(["overlay", "--volume", "noh5", "--pages", "229", "--sheet"]) == 0
    out = capsys.readouterr().out
    assert "0229.png" in out and "contact-sheet.html" in out


def test_main_catalog_reports_pieces_and_review(tmp_path, monkeypatch, capsys):
    import yaml

    from pipeline import catalog as catalog_mod

    index = tmp_path / "index.yml"
    index.write_text(yaml.safe_dump({"sections": [{"name": "Missa pro Defunctis", "entries": [
        {"label": "III", "title": "In Exsequiis Defunctorum", "genre": "exsequiis", "page": 180},
    ]}]}))
    monkeypatch.setattr(catalog_mod, "write_catalog", functools.partial(
        catalog_mod.write_catalog, data_dir=tmp_path, index_path=index))
    assert cli.main(["catalog", "--volume", "noh5"]) == 0
    assert "1 pieces" in capsys.readouterr().out


def test_main_offset_too_few_samples_is_refused_by_the_guard(tmp_path, monkeypatch):
    """The floor on agreed readings is the guard working, not a flake."""
    store = tmp_path / "offsets.json"
    monkeypatch.setattr(offset_mod, "persist",
                        functools.partial(offset_mod.persist, path=store))
    with pytest.raises(ValueError, match="folios agreed; need 10"):
        cli.main(["offset", "--volume", "noh5", "--sample-size", "12"])
    assert not store.exists(), "a refused offset must never be persisted"
