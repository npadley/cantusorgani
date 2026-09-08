from pathlib import Path

import pytest

from pipeline.upload import (
    CACHE_CONTROL,
    REQUIRED_VARS,
    content_type_for,
    require_credentials,
)

GOOD = {v: "x" for v in REQUIRED_VARS}


def test_credentials_come_from_the_environment():
    creds = require_credentials(GOOD | {"R2_ACCOUNT_ID": "acct"})
    assert creds.account_id == "acct"
    assert creds.endpoint == "https://acct.r2.cloudflarestorage.com"


@pytest.mark.parametrize("missing", REQUIRED_VARS)
def test_missing_credential_raises_naming_it(missing):
    env = {k: v for k, v in GOOD.items() if k != missing}
    with pytest.raises(RuntimeError, match=missing):
        require_credentials(env)


def test_empty_credential_counts_as_missing():
    with pytest.raises(RuntimeError, match="R2_BUCKET"):
        require_credentials(GOOD | {"R2_BUCKET": ""})


def test_no_credential_defaults_exist():
    """A default would silently publish to somebody else's bucket."""
    with pytest.raises(RuntimeError):
        require_credentials({})


@pytest.mark.parametrize("name,expected", [
    ("000.webp", "image/webp"), ("000@2x.png", "image/png"),
])
def test_content_types(name, expected):
    assert content_type_for(Path(name)) == expected


def test_unexpected_file_types_are_refused():
    """The uploader publishes to a public bucket; it must not be a general file
    transfer for whatever happens to be in build/."""
    with pytest.raises(ValueError, match="refusing to upload"):
        content_type_for(Path("secrets.env"))


def test_slices_are_cached_immutably():
    assert "immutable" in CACHE_CONTROL and "max-age=31536000" in CACHE_CONTROL
