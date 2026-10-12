"""Unit tests for the pre-inference path: image_prep.py plus the worker's
auth and SSRF guards in worker_security.py. Pure PIL and stdlib, no GPU, no
model runtime, no network egress. Runs locally and as a Docker build gate:

    python3 workers/model-triposplat/test_image_prep.py

Mirrors the sibling model-triposr suite minus the matting checks: this worker
has no matte step of its own (TripoSplatPipeline's own rmbg_path handles it),
so the only pre-inference logic here is decode + output naming.
"""

from __future__ import annotations

import base64
import io
import sys

from PIL import Image

from image_prep import (
    decode_data_uri,
    decode_image,
    open_rgb,
    splat_blob_name,
    splat_public_url,
)
from worker_security import UnsafeUrlError, assert_safe_url, require_api_key

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


def raises(exc_type, fn, *args, **kwargs) -> bool:
    try:
        fn(*args, **kwargs)
    except exc_type:
        return True
    except Exception:
        return False
    return False


def png_bytes(mode: str, size=(8, 8), color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format="PNG")
    return buf.getvalue()


def data_uri(payload: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def refuse_fetch(url: str) -> bytes:
    raise AssertionError(f"decode_image reached the network for {url}")


# -- decoding -----------------------------------------------------------------

img = decode_image(data_uri(png_bytes("RGB")), fetch=refuse_fetch)
check("data URI decodes to RGB", img.mode == "RGB", img.mode)
check("data URI keeps its size", img.size == (8, 8), str(img.size))

rgba_uri = data_uri(png_bytes("RGBA", color=(10, 20, 30, 255)))
check(
    "RGBA data URI is converted on decode",
    decode_image(rgba_uri, fetch=refuse_fetch).mode == "RGB",
)

check(
    "http:// is refused without a fetch",
    raises(ValueError, decode_image, "http://example.com/a.png", fetch=refuse_fetch),
)
check(
    "file path is refused",
    raises(ValueError, decode_image, "/etc/passwd", fetch=refuse_fetch),
)
check(
    "gs:// is refused",
    raises(ValueError, decode_image, "gs://bucket/a.png", fetch=refuse_fetch),
)
check(
    "https:// is routed to the injected fetcher",
    decode_image(
        "https://example.invalid/a.png", fetch=lambda _url: png_bytes("RGB")
    ).mode
    == "RGB",
)

check(
    "non-base64 data URI is refused",
    raises(ValueError, decode_data_uri, "data:image/png,rawbytes"),
)
check(
    "truncated base64 is refused",
    raises(ValueError, decode_data_uri, "data:image/png;base64,!!!!"),
)
check("payload-less data URI is refused", raises(ValueError, decode_data_uri, "data:image/png"))
check("garbage bytes are refused", raises(ValueError, open_rgb, b"not-an-image"))

# -- output naming (the contract the status endpoint reports) ----------------

check(
    "blob name is namespaced per model",
    splat_blob_name("abc-123") == "splats/triposplat/abc-123.splat",
    splat_blob_name("abc-123"),
)
check(
    "ply extension is accepted",
    splat_blob_name("abc-123", ext="ply") == "splats/triposplat/abc-123.ply",
    splat_blob_name("abc-123", ext="ply"),
)
check("empty task id is refused", raises(ValueError, splat_blob_name, ""))
check("unsupported extension is refused", raises(ValueError, splat_blob_name, "t1", ext="glb"))
check(
    "result url points at the output bucket",
    splat_public_url("three-ws-avatar-reconstructions", splat_blob_name("t1"))
    == "https://storage.googleapis.com/three-ws-avatar-reconstructions/splats/triposplat/t1.splat",
)

# -- auth ----------------------------------------------------------------------

require_api_key("Bearer s3cret", "s3cret")
PASS += 1
print("ok    valid bearer token is accepted")

check("wrong token is rejected", raises(PermissionError, require_api_key, "Bearer nope", "s3cret"))
check("missing header is rejected", raises(PermissionError, require_api_key, None, "s3cret"))
check("bare token without the scheme is rejected", raises(PermissionError, require_api_key, "s3cret", "s3cret"))
check("basic auth is rejected", raises(PermissionError, require_api_key, "Basic s3cret", "s3cret"))

# -- SSRF guard ----------------------------------------------------------------

check("cleartext http is refused", raises(UnsafeUrlError, assert_safe_url, "http://example.com/a.png"))
check("file scheme is refused", raises(UnsafeUrlError, assert_safe_url, "file:///etc/passwd"))
check("loopback is refused", raises(UnsafeUrlError, assert_safe_url, "https://127.0.0.1/a.png"))
check("localhost is refused", raises(UnsafeUrlError, assert_safe_url, "https://localhost/a.png"))
check(
    "the GCP metadata server is refused",
    raises(UnsafeUrlError, assert_safe_url, "https://169.254.169.254/computeMetadata/v1/"),
)
check("RFC1918 addresses are refused", raises(UnsafeUrlError, assert_safe_url, "https://10.128.0.7/a.png"))
check("IPv6 loopback is refused", raises(UnsafeUrlError, assert_safe_url, "https://[::1]/a.png"))
check(
    "an IPv4-mapped private address is refused",
    raises(UnsafeUrlError, assert_safe_url, "https://[::ffff:10.0.0.1]/a.png"),
)
check("a hostless url is refused", raises(UnsafeUrlError, assert_safe_url, "https:///a.png"))

print(f"\n{PASS} checks passed")
