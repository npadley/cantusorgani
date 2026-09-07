import pytest

from pipeline.folio import tesseract_available
from pipeline.offset import (
    OffsetResult,
    assert_consistent,
    derive_offset,
    load_offset,
    persist,
)

needs_tesseract = pytest.mark.skipif(
    not tesseract_available(), reason="tesseract not installed"
)


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_noh5_offset_is_46(tmp_path):
    result = derive_offset("noh5", tmp_path, sample_size=20)
    assert result.offset == 46
    assert result.confidence >= 0.9
    assert result.disagreements == []


def test_rejects_low_confidence():
    bad = OffsetResult(offset=46, confidence=0.55, samples=20, disagreements=[(9, 9)])
    with pytest.raises(ValueError, match="inconsistent"):
        assert_consistent("noh5", bad)


def test_rejects_too_few_samples():
    thin = OffsetResult(offset=46, confidence=1.0, samples=4, disagreements=[])
    with pytest.raises(ValueError, match="need 10"):
        assert_consistent("noh5", thin)


def test_accepts_clean_result():
    good = OffsetResult(offset=46, confidence=1.0, samples=20, disagreements=[])
    assert_consistent("noh5", good)


@pytest.mark.source
def test_persisted_offset_is_bound_to_the_source_checksum(tmp_path):
    """An offset must not survive a change of source PDF: it would silently
    describe a document that no longer exists."""
    store = tmp_path / "offsets.json"
    persist("noh5", OffsetResult(46, 1.0, 20, []), path=store)
    assert load_offset("noh5", path=store) == 46

    import json
    data = json.loads(store.read_text())
    data["noh5"]["source_sha256"] = "0" * 64
    store.write_text(json.dumps(data))
    with pytest.raises(RuntimeError, match="different source PDF"):
        load_offset("noh5", path=store)
