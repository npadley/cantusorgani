"""published(): transient failures are retried; only a definite absence counts as missing."""

from __future__ import annotations

import urllib.error
from contextlib import contextmanager
from typing import Any

from pipeline.typeset.publish import published
from pipeline.typeset.render import FILES


class _Response:
    def __init__(self, status: int) -> None:
        self.status = status


def _opener(script: list[Any]) -> Any:
    """Each call takes the next scripted outcome: an int status, or an exception to raise."""
    calls = iter(script)

    @contextmanager
    def opener(_request: Any, timeout: int) -> Any:
        outcome = next(calls)
        if isinstance(outcome, BaseException):
            raise outcome
        yield _Response(outcome)

    return opener


def _http(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://x", code, "x", None, None)  # type: ignore[arg-type]


def test_published_all_files_200_true() -> None:
    assert published("https://x", "d", opener=_opener([200] * len(FILES)), sleep=lambda _s: None)


def test_published_timeout_then_200_retries_and_is_true() -> None:
    script = [TimeoutError("slow"), 200] + [200] * (len(FILES) - 1)
    assert published("https://x", "d", opener=_opener(script), sleep=lambda _s: None)


def test_published_server_error_then_200_retries_and_is_true() -> None:
    script = [_http(503), _http(429), 200] + [200] * (len(FILES) - 1)
    assert published("https://x", "d", opener=_opener(script), sleep=lambda _s: None)


def test_published_404_is_false_without_retry() -> None:
    script = [_http(404)]  # a second call would exhaust the script and fail the test
    assert not published("https://x", "d", opener=_opener(script), sleep=lambda _s: None)


def test_published_persistent_timeouts_are_false_after_three_attempts() -> None:
    slept: list[float] = []
    script = [TimeoutError("a"), TimeoutError("b"), TimeoutError("c")]
    assert not published("https://x", "d", opener=_opener(script), sleep=slept.append)
    assert slept == [1, 2]
