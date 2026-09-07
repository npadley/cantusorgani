import pytest

from pipeline.cli import build_parser, parse_pages


@pytest.mark.parametrize("spec,expected", [
    ("229", [229]),
    ("5-11", [5, 6, 7, 8, 9, 10, 11]),
    ("5,11,229", [5, 11, 229]),
    ("1-3,229", [1, 2, 3, 229]),
    ("229,229", [229]),
])
def test_parse_pages(spec, expected):
    assert parse_pages(spec) == expected


def test_parse_pages_rejects_descending_range():
    with pytest.raises(ValueError, match="descending"):
        parse_pages("11-5")


def test_volume_is_required_no_default():
    """There is no sensible default volume; guessing one would silently operate
    on the wrong book."""
    with pytest.raises(SystemExit):
        build_parser().parse_args(["render"])
