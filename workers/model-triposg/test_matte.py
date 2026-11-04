"""Unit tests for matte.py, the rembg-service matte that replaced RMBG-1.4.

Real Pillow and httpx (an httpx.MockTransport stands in for the network, so the
exact request/poll/fetch contract of workers/rembg is exercised), no torch, no
CUDA, no TripoSG tree:

    python3 workers/model-triposg/test_matte.py
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

import matte  # noqa: E402

SERVICE = "https://rembg.test"
RESULT_URL = "https://storage.googleapis.com/bucket/rembg/t1.png"


def _photo(size=(64, 64)) -> Image.Image:
    """An opaque RGB photo: a red square on a grey background."""
    img = Image.new("RGB", size, (128, 128, 128))
    for x in range(16, 48):
        for y in range(16, 48):
            img.putpixel((x, y), (200, 30, 30))
    return img


def _cutout(size=(64, 64), subject=True) -> bytes:
    """What rembg-service writes: RGBA with the subject opaque, background clear."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    if subject:
        w, h = size
        for x in range(w // 4, 3 * w // 4):
            for y in range(h // 4, 3 * h // 4):
                img.putpixel((x, y), (200, 30, 30, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _service(polls, seen):
    """A rembg-service double following workers/rembg/main.py's contract."""
    queue = list(polls)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.headers.get("authorization")))
        if request.method == "POST" and request.url.path == "/remove":
            body = json.loads(request.content)
            assert body["model"] == "birefnet-general-lite", body
            assert body["image"].startswith("data:image/png;base64,")
            decoded = Image.open(io.BytesIO(base64.b64decode(body["image"].split(",", 1)[1])))
            assert decoded.mode == "RGB", "the service is sent opaque RGB"
            return httpx.Response(202, json={"task_id": "t1"})
        if request.method == "GET" and request.url.path == "/tasks/t1":
            return httpx.Response(200, json=queue.pop(0))
        return httpx.Response(404, json={"detail": "nope"})

    return httpx.Client(transport=httpx.MockTransport(handler))


def _run(polls, cutout_bytes, photo=None):
    seen = []
    fetched = []

    def fetch(url):
        fetched.append(url)
        return cutout_bytes

    out = matte.matte_photo(
        photo or _photo(),
        service_url=SERVICE,
        api_key="k",
        fetch_bytes=fetch,
        client=_service(polls, seen),
        sleep=lambda _s: None,
    )
    return out, seen, fetched


def test_alpha_rule_matches_upstream():
    assert not matte.alpha_is_usable(_photo()), "RGB has no alpha"
    assert not matte.alpha_is_usable(_photo().convert("RGBA")), "fully opaque alpha is not a matte"
    clear = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    assert not matte.alpha_is_usable(clear), "fully transparent alpha is not a matte"
    assert matte.alpha_is_usable(Image.open(io.BytesIO(_cutout())))


def test_photo_is_matted_through_the_service():
    polls = [{"status": "running"}, {"status": "done", "result_url": RESULT_URL}]
    out, seen, fetched = _run(polls, _cutout())
    assert [s[:2] for s in seen] == [("POST", "/remove"), ("GET", "/tasks/t1"), ("GET", "/tasks/t1")]
    assert all(s[2] == "Bearer k" for s in seen), "every call is authenticated"
    assert fetched == [RESULT_URL]
    assert out.mode == "RGBA" and out.size == (64, 64)
    assert matte.alpha_is_usable(out)
    # Colour comes from the caller's photo; only the alpha comes from the matte.
    assert out.getpixel((0, 0)) == (128, 128, 128, 0)
    assert out.getpixel((32, 32)) == (200, 30, 30, 255)


def test_cutout_at_another_size_is_resized_to_the_photo():
    polls = [{"status": "done", "result_url": RESULT_URL}]
    out, _, _ = _run(polls, _cutout(size=(32, 32)))
    assert out.size == (64, 64)
    assert matte.alpha_is_usable(out)


def test_existing_cutout_skips_the_network():
    seen = []
    prepared = Image.open(io.BytesIO(_cutout()))
    out = matte.matte_photo(
        prepared,
        service_url=SERVICE,
        api_key="k",
        fetch_bytes=lambda _u: (_ for _ in ()).throw(AssertionError("no fetch")),
        client=_service([], seen),
        sleep=lambda _s: None,
    )
    assert seen == []
    assert matte.alpha_is_usable(out)


def test_empty_matte_is_no_subject():
    polls = [{"status": "done", "result_url": RESULT_URL}]
    try:
        _run(polls, _cutout(subject=False))
    except matte.NoSubjectFound:
        return
    raise AssertionError("expected NoSubjectFound")


def test_service_failure_is_matte_unavailable():
    for polls in (
        [{"status": "failed", "error": "model crashed"}],
        [{"status": "done"}],
    ):
        try:
            _run(polls, _cutout())
        except matte.MatteUnavailable:
            continue
        raise AssertionError(f"expected MatteUnavailable for {polls}")


def test_unconfigured_service_is_matte_unavailable():
    try:
        matte.matte_photo(_photo(), service_url="", api_key="k", fetch_bytes=lambda _u: b"")
    except matte.MatteUnavailable as exc:
        assert "REMBG_SERVICE_URL" in str(exc)
        return
    raise AssertionError("expected MatteUnavailable")


def test_submit_error_is_matte_unavailable():
    client = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(503, text="down")))
    try:
        matte.matte_photo(
            _photo(), service_url=SERVICE, api_key="k", fetch_bytes=lambda _u: b"", client=client, sleep=lambda _s: None
        )
    except matte.MatteUnavailable:
        return
    raise AssertionError("expected MatteUnavailable")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
    sys.exit(0)
