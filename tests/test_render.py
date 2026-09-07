import pytest
from PIL import Image

from pipeline.render import render_page


@pytest.mark.source
@pytest.mark.slow
def test_render_page_produces_expected_dimensions(tmp_path):
    out = render_page("noh5", pdf_page=229, dest_dir=tmp_path, dpi=300)
    assert out.exists()
    w, h = Image.open(out).size
    assert 2400 < w < 2700
    assert 3300 < h < 3700


@pytest.mark.source
def test_render_rejects_out_of_range_page(tmp_path):
    with pytest.raises(ValueError, match="out of range"):
        render_page("noh5", pdf_page=999, dest_dir=tmp_path)


@pytest.mark.source
@pytest.mark.slow
def test_render_is_cached(tmp_path):
    a = render_page("noh5", 229, dest_dir=tmp_path)
    mtime = a.stat().st_mtime_ns
    b = render_page("noh5", 229, dest_dir=tmp_path)
    assert b.stat().st_mtime_ns == mtime, "second call must reuse the cached render"
