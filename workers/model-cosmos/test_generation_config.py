import base64

import pytest

import generation_config as cfg
from generation_config import RequestError, eta_seconds, parse_request

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def data_url(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def test_text_defaults():
    req = parse_request({"prompt": "  a lighthouse   at dusk "})
    assert req.mode == "text"
    assert req.prompt == "a lighthouse at dusk"
    assert (req.height, req.width) == (720, 1280)
    assert req.num_frames == 121
    assert req.preset.steps == 35 and req.preset.guidance == 6.0 and req.fps == 24
    assert req.duration_label == "5s"


def test_resolution_480_and_default_override():
    assert parse_request({"prompt": "abc", "resolution": "480"}).width == 832
    assert parse_request({"prompt": "abc"}, default_resolution="480").height == 480
    with pytest.raises(RequestError):
        parse_request({"prompt": "abc", "resolution": "1080"})


@pytest.mark.parametrize("frames", [32, 34, 125, 0, "x", True])
def test_bad_frame_counts(frames):
    with pytest.raises(RequestError):
        parse_request({"prompt": "abc", "num_frames": frames})


def test_frame_count_accepts_1_plus_4k():
    assert parse_request({"prompt": "abc", "num_frames": 61}).num_frames == 61


def test_image_mode_requires_a_real_image():
    req = parse_request({"mode": "image", "prompt": "walk", "image": data_url("image/png", PNG_1PX)})
    assert req.image_bytes == PNG_1PX
    with pytest.raises(RequestError, match="image must be"):
        parse_request({"mode": "image", "prompt": "walk"})
    with pytest.raises(RequestError, match="must be one of"):
        parse_request({"mode": "image", "prompt": "walk", "image": data_url("image/gif", PNG_1PX)})
    with pytest.raises(RequestError, match="not valid base64"):
        parse_request({"mode": "image", "prompt": "walk", "image": "data:image/png;base64,@@@"})


def test_transfer_modes_take_a_control_video_and_transfer_preset():
    req = parse_request({"mode": "depth", "prompt": "a forest", "control_video": data_url("video/webm", b"\x1a\x45\xdf\xa3")})
    assert req.control_bytes.startswith(b"\x1a\x45")
    assert req.preset.steps == 50 and req.preset.control_guidance == 1.5 and req.fps == 30
    with pytest.raises(RequestError, match="control_video"):
        parse_request({"mode": "edge", "prompt": "a forest"})


def test_oversized_payload_rejected_before_decode():
    huge = "A" * (cfg.MAX_IMAGE_BYTES * 2)
    with pytest.raises(RequestError, match="larger than"):
        parse_request({"mode": "image", "prompt": "walk", "image": f"data:image/png;base64,{huge}"})


@pytest.mark.parametrize("body", [None, [], {"prompt": "ab"}, {"prompt": "x" * 601}, {"prompt": "abc", "mode": "audio"}, {"prompt": "abc", "seed": -1}])
def test_rejects_bad_bodies(body):
    with pytest.raises(RequestError):
        parse_request(body)


def test_eta():
    assert eta_seconds(0, 10) is None
    assert eta_seconds(0.5, 30) == 30
    assert eta_seconds(1, 30) == 0
