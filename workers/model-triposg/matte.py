"""Image-mode background matte for TripoSG, served by the sibling rembg-service.

Why this exists: TripoSG's upstream preprocessing removes the photographic
background with briaai/RMBG-1.4, whose weights ship under a NON-COMMERCIAL
licence, and Forge is a paid product. This worker no longer loads those weights.
Instead the photo is matted by workers/rembg (rembg, MIT) running BiRefNet
(`birefnet-general-lite`, MIT), the same sibling service model-trellis already
uses for its matte pre-step, and the resulting RGBA image is handed to
upstream's prepare_image with no in-process remover.

That works because upstream's load_image skips its own remover entirely when
the input already carries a usable alpha channel (at least 1% of pixels in the
lowest and in the highest of 20 alpha histogram bins), and then crops,
recenters and composites over white using that alpha. `alpha_is_usable` below
is the same test, so whatever this module returns never reaches the remover
code path (which would now have no network to call and crash).

Stdlib + Pillow + httpx only, so every rule here is tested without torch, CUDA,
or the TripoSG source tree:

    python3 workers/model-triposg/test_matte.py
"""

from __future__ import annotations

import base64
import io
import time
from typing import Callable, Optional

import httpx
from PIL import Image

DEFAULT_MATTE_MODEL = "birefnet-general-lite"
DEFAULT_MATTE_TIMEOUT_S = 120.0
POLL_INTERVAL_S = 1.5

# Upstream's is_valid_alpha: 20 histogram bins over 0..255, and both the lowest
# bin (alpha < 12.8) and the highest bin (alpha >= 242.25) must hold at least
# 1% of the pixels.
_ALPHA_BINS = 20
_ALPHA_MIN_RATIO = 0.01


class MatteUnavailable(RuntimeError):
    """The matte service could not produce a cutout (unconfigured, down, slow,
    or answered garbage). A worker-side fault: the task fails as an internal
    error and the platform's failover re-dispatches it to the next lane."""


class NoSubjectFound(ValueError):
    """The matte came back with no usable foreground: the caller's photo has no
    subject the matting model can separate from the background."""


def alpha_is_usable(img: Image.Image) -> bool:
    """True when `img` carries an alpha channel upstream will use as-is."""
    if img.mode != "RGBA":
        return False
    hist = img.getchannel("A").histogram()
    total = img.width * img.height
    if total == 0:
        return False
    bin_width = 256 / _ALPHA_BINS
    low = sum(hist[v] for v in range(256) if v < bin_width)
    high = sum(hist[v] for v in range(256) if v >= 256 - bin_width)
    floor = total * _ALPHA_MIN_RATIO
    return low >= floor and high >= floor


def _png_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def matte_photo(
    img: Image.Image,
    *,
    service_url: str,
    api_key: str,
    fetch_bytes: Callable[[str], bytes],
    model: str = DEFAULT_MATTE_MODEL,
    timeout_s: float = DEFAULT_MATTE_TIMEOUT_S,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Image.Image:
    """Return `img` as RGBA with a usable alpha matte.

    A photo that already has one (a cutout the caller prepared) is returned
    unchanged and costs no network call. Otherwise the opaque RGB is sent to
    rembg-service, polled to completion, and the cutout is fetched with
    `fetch_bytes` (the worker's SSRF-hardened fetch). Raises MatteUnavailable
    for a service fault and NoSubjectFound when the matte is empty.
    """
    rgba = img.convert("RGBA")
    if alpha_is_usable(rgba):
        return rgba
    base = (service_url or "").rstrip("/")
    if not base:
        raise MatteUnavailable("REMBG_SERVICE_URL is not set; image mode needs the matte service")

    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.monotonic() + timeout_s
    own_client = client is None
    http = client or httpx.Client(timeout=30)
    try:
        try:
            resp = http.post(f"{base}/remove", headers=headers, json={"image": _png_data_uri(rgba), "model": model})
            resp.raise_for_status()
            task_id = resp.json()["task_id"]
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise MatteUnavailable(f"matte submit failed ({type(exc).__name__})") from exc

        while True:
            if time.monotonic() >= deadline:
                raise MatteUnavailable(f"matte did not finish within {int(timeout_s)} s")
            sleep(POLL_INTERVAL_S)
            try:
                poll = http.get(f"{base}/tasks/{task_id}", headers=headers)
                poll.raise_for_status()
                state = poll.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise MatteUnavailable(f"matte poll failed ({type(exc).__name__})") from exc
            status = state.get("status")
            if status == "failed":
                raise MatteUnavailable(f"matte service failed: {str(state.get('error') or 'no detail')[:200]}")
            if status == "done":
                url = state.get("result_url")
                if not url:
                    raise MatteUnavailable("matte service finished without a result_url")
                break
    finally:
        if own_client:
            http.close()

    try:
        cutout = Image.open(io.BytesIO(fetch_bytes(url))).convert("RGBA")
    except Exception as exc:  # noqa: BLE001, any fetch/decode fault is the service's
        raise MatteUnavailable(f"matte result unreadable ({type(exc).__name__})") from exc
    if cutout.size != rgba.size:
        cutout = cutout.resize(rgba.size, Image.LANCZOS)
    # Keep the caller's original pixels and take only the matte's alpha, so the
    # colours reconstructed are exactly the photo's, never a re-encoded copy.
    out = rgba.copy()
    out.putalpha(cutout.getchannel("A"))
    if not alpha_is_usable(out):
        raise NoSubjectFound("no subject could be separated from the background")
    return out
