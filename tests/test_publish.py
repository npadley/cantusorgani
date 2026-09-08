import pytest
from PIL import Image

from pipeline.publish import r2_key, slice_systems


def test_key_embeds_a_content_hash_so_reruns_never_overwrite():
    key = r2_key("noh5", 229, 0, sha256="deadbeefcafebabe" + "0" * 48)
    assert key == "systems/noh5/0229/000-deadbeefcafe.webp"


def test_different_content_yields_a_different_key():
    a = r2_key("noh5", 229, 0, sha256="a" * 64)
    b = r2_key("noh5", 229, 0, sha256="b" * 64)
    assert a != b, "a re-run that changes a slice must not reuse its URL"


def test_key_variants_are_distinct():
    digest = "c" * 64
    assert r2_key("noh5", 229, 0, digest, "@2x") != r2_key("noh5", 229, 0, digest)
    assert r2_key("noh5", 229, 0, digest, "@2x", "png").endswith("@2x.png")


def test_key_rejects_a_truncated_digest():
    with pytest.raises(ValueError, match="full hex digest"):
        r2_key("noh5", 229, 0, sha256="abc")


@pytest.mark.source
@pytest.mark.slow
def test_slices_are_written_in_all_three_variants(tmp_path):
    slices = slice_systems("noh5", pdf_page=229, dest=tmp_path)
    assert len(slices) == 5
    for s in slices:
        assert len(s.paths) == 3
        for path in s.paths:
            assert path.exists() and path.stat().st_size > 0
        assert Image.open(s.paths[1]).width == s.width


@pytest.mark.source
@pytest.mark.slow
def test_half_size_variant_is_half_the_width(tmp_path):
    s = slice_systems("noh5", 229, dest=tmp_path)[0]
    assert Image.open(s.paths[0]).width == pytest.approx(s.width // 2, abs=1)


@pytest.mark.source
@pytest.mark.slow
def test_lossless_encoding_keeps_slices_small(tmp_path):
    """Bitonal music must not be encoded lossily: measured, lossy WebP q82 is six
    times larger than lossless from a bilevel source AND smears the noteheads."""
    slices = slice_systems("noh5", 229, dest=tmp_path)
    avg = sum(s.paths[1].stat().st_size for s in slices) / len(slices)
    assert avg < 15_000, f"2x webp averaging {avg:.0f}B; lossy encoding crept back in"


@pytest.mark.source
@pytest.mark.slow
def test_a_page_with_no_systems_yields_no_slices(tmp_path):
    assert slice_systems("noh5", 231, dest=tmp_path) == []


@pytest.mark.source
@pytest.mark.slow
def test_trimming_preserves_the_mode_number_and_brace(tmp_path):
    """PDF 229 system 4 carries the mode 'II' left of the brace. Trimming must
    never reach past it: measured, an ink threshold of 12 cuts to the brace."""
    trimmed = slice_systems("noh5", 229, dest=tmp_path / "t", trim=True)[3]
    untrimmed = slice_systems("noh5", 229, dest=tmp_path / "u", trim=False)[3]
    assert trimmed.width < untrimmed.width, "trim should remove some dead margin"
    assert trimmed.width > untrimmed.width * 0.6, "trim removed too much"


@pytest.mark.source
@pytest.mark.slow
def test_catalog_aspect_matches_the_published_slice(tmp_path):
    """The catalog's system_aspect must describe the image actually served.

    It recorded the PRE-trim box while the published slice was POST-trim, so
    every system rendered letterboxed inside a slot wider than its own picture.
    Caught by looking at the page, not by any test that existed.
    """
    from pipeline.publish import trimmed_boxes

    for page in (51, 229):
        boxes = trimmed_boxes("noh5", page)
        slices = slice_systems("noh5", page, dest=tmp_path / str(page))
        assert len(boxes) == len(slices)
        for (left, top, right, bottom), sliced in zip(boxes, slices):
            assert (right - left, bottom - top) == (sliced.width, sliced.height)
