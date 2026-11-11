"""Fetch a poster image, waiting out a 429 from the renderer.

Creations without a stored preview are described from three.ws/api/render,
which rate limits. A 429 is a request to slow down, not a broken image, so the
fetch waits (the Retry-After header when sent, else a growing backoff, capped)
and tries again. Every other error is raised at once.
"""

from __future__ import annotations

import time
from typing import Callable

import httpx

from worker_security import fetch_remote_bytes

ATTEMPTS = 4
BASE_WAIT_S = 3.0
MAX_WAIT_S = 30.0


def _wait_seconds(exc: httpx.HTTPStatusError, attempt: int) -> float:
    raw = exc.response.headers.get("retry-after")
    try:
        wait = float(raw) if raw is not None else BASE_WAIT_S * (2**attempt)
    except ValueError:
        wait = BASE_WAIT_S * (2**attempt)
    return max(0.5, min(wait, MAX_WAIT_S))


def fetch_poster(
    url: str,
    *,
    timeout: float = 30.0,
    max_bytes: int = 12 * 1024 * 1024,
    fetch: Callable[..., bytes] = fetch_remote_bytes,
    sleep: Callable[[float], None] = time.sleep,
) -> bytes:
    for attempt in range(ATTEMPTS):
        try:
            return fetch(url, timeout=timeout, max_bytes=max_bytes)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 429 or attempt == ATTEMPTS - 1:
                raise
            sleep(_wait_seconds(exc, attempt))
    raise RuntimeError("unreachable")
