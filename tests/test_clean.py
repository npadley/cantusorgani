"""Task 8: deskew and despeckle."""

import cv2
import numpy as np
import pytest

from pipeline.clean import clean_page, estimate_skew


def _ruled(angle: float) -> np.ndarray:
    img = np.full((800, 1200), 255, dtype=np.uint8)
    for y in (200, 400, 600):
        img[y:y + 4, 100:1100] = 0
    m = cv2.getRotationMatrix2D((600.0, 400.0), angle, 1.0)
    return cv2.warpAffine(img, m, (1200, 800), flags=cv2.INTER_NEAREST, borderValue=255)


def test_estimate_skew_recovers_a_known_rotation() -> None:
    assert abs(estimate_skew(_ruled(0.0))) < 0.15
    assert estimate_skew(_ruled(1.3)) == pytest.approx(-1.3, abs=0.15)
    assert estimate_skew(_ruled(-2.4)) == pytest.approx(2.4, abs=0.15)


def test_blank_page_is_not_rotated() -> None:
    blank = np.full((800, 1200), 255, dtype=np.uint8)
    assert estimate_skew(blank) == 0.0, "must not return -limit on a tie"


def test_clean_preserves_shape() -> None:
    img = np.full((800, 1200), 255, dtype=np.uint8)
    out = clean_page(img)
    assert out.shape == img.shape
    assert out.dtype == np.uint8


def test_clean_page_binarises() -> None:
    img = np.full((400, 600), 200, dtype=np.uint8)
    img[100:120, 50:550] = 40
    out = clean_page(img)
    assert set(np.unique(out)).issubset({0, 255})
