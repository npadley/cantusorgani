"""Stage 2: deskew and despeckle a rendered page.

Deskew maximises the variance of the horizontal ink projection: when the staff
lines are level, every line's ink lands in a handful of rows and the profile is
spiky; when the page is rotated, the ink smears across many rows and the profile
flattens. Variance is the cheapest sharp measure of "spiky".

Measured on NOH5 renders (2540x3490, 2026-09-07): body-page skew sits between
-0.4 and +0.4 degrees, so the +-5 degree search limit is generous. The search is
run on a downscaled copy (longest side 1200px) because rotating the full 8.9MP
page 101 times costs ~14s and buys nothing: at 1200px wide a 0.1 degree step
still moves the page edge by ~1px, which is the resolution of the answer.
"""

from __future__ import annotations

import cv2
import numpy as np

SKEW_LIMIT = 5.0
SKEW_STEP = 0.1
# Longest side used for the rotation search. See module docstring.
SKEW_WORK_SIZE = 1200
# A page with no long horizontal structure scores nearly the same at every angle.
# Require the winner to beat the do-nothing angle by this factor before trusting it.
SKEW_MIN_GAIN = 1.05


def estimate_skew(gray: np.ndarray, limit: float = SKEW_LIMIT,
                  step: float = SKEW_STEP) -> float:
    """Angle in degrees maximising row-variance of the horizontal projection.

    Returns the angle to rotate *by* to level the page (the negative of the
    page's own skew). Returns 0.0 for a blank page or one with no dominant
    horizontal structure, rather than silently rotating it by the search limit.
    """
    inv = (255 - gray).astype(np.float32)
    longest = max(inv.shape)
    if longest > SKEW_WORK_SIZE:
        scale = SKEW_WORK_SIZE / longest
        inv = cv2.resize(inv, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    if float(inv.mean()) < 1.0:
        return 0.0

    h, w = inv.shape
    centre = (w / 2, h / 2)
    zero_score = float(np.var(inv.sum(axis=1)))
    best_angle, best_score = 0.0, -1.0
    for angle in np.arange(-limit, limit + step, step):
        m = cv2.getRotationMatrix2D(centre, float(angle), 1.0)
        rot = cv2.warpAffine(inv, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=0.0)
        score = float(np.var(rot.sum(axis=1)))
        if score > best_score:
            best_angle, best_score = float(angle), score
    if best_score < zero_score * SKEW_MIN_GAIN:
        return 0.0
    return best_angle


def deskew(gray: np.ndarray, angle: float) -> np.ndarray:
    """Rotate `gray` about its centre by `angle` degrees, padding with white."""
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=255)


def clean_page(gray: np.ndarray) -> np.ndarray:
    """Deskew, despeckle and binarise one page. Shape and dtype are preserved."""
    rot = deskew(gray, estimate_skew(gray))
    den = cv2.medianBlur(rot, 3)
    _, binary = cv2.threshold(den, 127, 255, cv2.THRESH_BINARY)
    return binary
