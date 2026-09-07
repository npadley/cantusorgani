import pytest

from pipeline.checksum import verify_volume


@pytest.mark.source
def test_noh5_checksum_matches_registry():
    assert verify_volume("noh5") is True
