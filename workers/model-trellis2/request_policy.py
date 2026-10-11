"""Request policy for the TRELLIS.2 worker: resolution tiers and transient-fetch retry.

Free of torch, CUDA and the TRELLIS.2 source tree so the decisions that shape
every generation import and unit test on any machine (see test_request_policy.py).
main.py imports every public name here; nothing in this file touches the GPU.

Two policies live here:

  1. Resolution resolution. A caller sends an optional `resolution` (512, 1024
     or 1536) and/or a named `tier`; this module turns that into the pipeline
     type, texture size and decimation target TRELLIS.2 runs with, and says how
     to step down when the GPU cannot hold the requested size.
  2. Transient-fetch retry. Caller-supplied image URLs are fetched over the
     public internet, where a single read timeout would otherwise fail a whole
     generation. `call_with_retry` re-runs the fetch for errors worth retrying
     and gives up at once on the ones that are not.
"""

from __future__ import annotations

from typing import Callable, Optional

import httpx

# Resolution is the O-Voxel grid the shape and texture are generated at. The
# cascade pipelines solve a coarse 512 structure first, then refine it, which is
# how TRELLIS.2 reaches 1024 and 1536 inside a 24 GB card.
RESOLUTIONS = (512, 1024, 1536)
DEFAULT_RESOLUTION = 1024

PIPELINE_TYPES = {
    512: "512",
    1024: "1024_cascade",
    1536: "1536_cascade",
}

# What each resolution bakes. Texture size must stay a power of two (the bake
# builds a mip stack); the decimation target is the face budget handed to the
# mesh simplifier before UV unwrapping. The 512 lane is the latency lane.
RESOLUTION_PRESETS = {
    512: {"texture_size": 2048, "decimation_target": 300_000},
    1024: {"texture_size": 4096, "decimation_target": 1_000_000},
    1536: {"texture_size": 4096, "decimation_target": 1_500_000},
}

# The forge lanes already speak quality tiers; map them onto the resolutions so a
# tier request and a resolution request land on the same presets.
TIER_RESOLUTION = {
    "draft": 512,
    "standard": 1024,
    "high": 1024,
    "max": 1536,
}

TEXTURE_SIZE_MIN = 512
TEXTURE_SIZE_MAX = 4096
DECIMATION_MIN = 50_000
DECIMATION_MAX = 2_000_000


def normalize_tier(tier: Optional[str]) -> Optional[str]:
    """Lowercase and trim a caller's tier string, or None when none was sent."""
    if tier is None:
        return None
    key = str(tier).strip().lower()
    return key or None


def resolve_resolution(resolution: Optional[int], tier: Optional[str] = None) -> int:
    """The grid resolution to run at.

    An explicit `resolution` wins and snaps to the nearest supported size (a
    caller asking for 2048 gets 1536, a 700 gets 512 or 1024 by closeness). With
    none, the named tier decides, and with neither the platform default applies.
    An unparseable value falls back to the default rather than failing the job.
    """
    if resolution is not None:
        try:
            wanted = int(resolution)
        except (TypeError, ValueError):
            return DEFAULT_RESOLUTION
        return min(RESOLUTIONS, key=lambda r: (abs(r - wanted), r))
    return TIER_RESOLUTION.get(normalize_tier(tier) or "", DEFAULT_RESOLUTION)


def clamp_to_ceiling(resolution: int, ceiling: Optional[int]) -> int:
    """Cap a resolution at what this deployment's GPU class can serve."""
    if not ceiling:
        return resolution
    allowed = [r for r in RESOLUTIONS if r <= ceiling]
    return min(resolution, max(allowed)) if allowed else RESOLUTIONS[0]


def step_down(resolution: int) -> Optional[int]:
    """The next smaller resolution to retry at after an out-of-memory failure."""
    smaller = [r for r in RESOLUTIONS if r < resolution]
    return max(smaller) if smaller else None


def bake_params(
    resolution: int,
    texture_size: Optional[int] = None,
    decimation_target: Optional[int] = None,
) -> dict:
    """The clamped bake parameters for a resolution plus optional overrides.

    texture_size snaps DOWN to a power of two inside the envelope: the texture
    bake hard-fails on any other extent. Unparseable overrides fall back to the
    resolution's preset.
    """
    preset = RESOLUTION_PRESETS[resolution]

    def number(raw, fallback, lo, hi):
        if raw is None:
            return fallback
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return fallback
        return max(lo, min(hi, value))

    tex = number(texture_size, preset["texture_size"], TEXTURE_SIZE_MIN, TEXTURE_SIZE_MAX)
    tex = 1 << (tex.bit_length() - 1)
    return {
        "texture_size": tex,
        "decimation_target": number(
            decimation_target, preset["decimation_target"], DECIMATION_MIN, DECIMATION_MAX
        ),
    }


# Total attempts (not extra retries) for one caller-supplied image URL, and the
# first backoff gap. Three attempts at 1s then 2s costs at most a few seconds of
# an already-asynchronous job, and covers the single-blip read timeouts that
# were failing whole generations from the public internet.
FETCH_ATTEMPTS = 3
FETCH_RETRY_BASE_SECONDS = 1.0

# Upstream status codes worth a second try. Everything else (404, 403, 400) is a
# statement about the URL itself and will fail identically on every attempt.
_RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def retry_delays(
    attempts: int = FETCH_ATTEMPTS, base: float = FETCH_RETRY_BASE_SECONDS
) -> list[float]:
    """Exponential backoff gaps between attempts (one fewer than `attempts`)."""
    return [base * (2 ** i) for i in range(max(0, attempts - 1))]


def is_transient_fetch_error(exc: BaseException) -> bool:
    """True when re-fetching the same URL could plausibly succeed.

    Timeouts and connection-level failures are the blips this exists for. An
    HTTP error is transient only for the status codes above; a 404 is not going
    to become a 200 on the next attempt.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    return isinstance(
        exc, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)
    )


def call_with_retry(
    fn: Callable[[], object],
    *,
    attempts: int = FETCH_ATTEMPTS,
    should_retry: Callable[[BaseException], bool] = is_transient_fetch_error,
    sleep: Callable[[float], None],
    on_retry: Optional[Callable[[int, float, BaseException], None]] = None,
):
    """Call `fn`, retrying with exponential backoff while `should_retry` holds.

    Re-raises the last exception once the attempts are spent or the error is not
    retryable. `sleep` is injected so the policy stays testable without wall
    clock time; `on_retry` receives (attempt_number, delay, exception) for
    logging.
    """
    delays = retry_delays(attempts)
    last: BaseException
    for index in range(max(1, attempts)):
        try:
            return fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised below after the budget
            last = exc
            if index >= len(delays) or not should_retry(exc):
                raise
            delay = delays[index]
            if on_retry:
                on_retry(index + 1, delay, exc)
            sleep(delay)
    raise last
