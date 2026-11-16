import asyncio
import json

import httpx

import upsampler
from upsampler import Upsampler, build_prompt_text, extract_json_object, force_output_parameters


def test_prompt_text_matches_upstream_shape():
    text = build_prompt_text("a fox in snow", resolution="720", aspect_ratio="16,9", duration="5s", fps=24, image_conditioned=False)
    assert "Given the user's natural-language request below" in text
    assert "a fox in snow\n\nOutput parameters: resolution 720, aspect_ratio 16,9, duration 5s, fps 24." in text
    assert "IMAGE INPUT" not in text
    assert "$" not in text.replace("$THREE", "")  # every template slot filled
    image_text = build_prompt_text("walk", resolution="480", aspect_ratio="16,9", duration="5s", fps=24, image_conditioned=True)
    assert "attached starting frame image" in image_text and "IMAGE INPUT" in image_text


def test_extract_json_object_fenced_bare_and_chatty():
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json_object('{"a": 2}') == {"a": 2}
    assert extract_json_object('Here you go: {"a": 3} hope it helps') == {"a": 3}


def test_force_output_parameters_overrides_model_values():
    out = force_output_parameters({"resolution": {"H": 1, "W": 1}, "fps": 99, "scene": "x"}, height=720, width=1280, aspect_ratio="16,9", duration="5s", fps=24)
    assert out == {"resolution": {"H": 720, "W": 1280}, "fps": 24, "scene": "x", "aspect_ratio": "16,9", "duration": "5s"}


def _run(coro):
    return asyncio.run(coro)


KW = dict(resolution="720", aspect_ratio="16,9", height=720, width=1280, duration="5s", fps=24)


def test_falls_through_models_then_succeeds():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body["model"])
        assert body["chat_template_kwargs"] == {"enable_thinking": False}
        if body["model"] == "first":
            return httpx.Response(503, text="busy")
        return httpx.Response(200, json={"choices": [{"message": {"content": '```json\n{"scene": "fox"}\n```'}}]})

    ups = Upsampler(api_key="k", models=("first", "second"), transport=httpx.MockTransport(handler))
    res = _run(ups.upsample("a fox", **KW))
    assert seen == ["first", "second"]
    assert res.upsampler == "second" and res.structured
    assert json.loads(res.prompt)["resolution"] == {"H": 720, "W": 1280}


def test_plain_prompt_when_every_model_fails():
    ups = Upsampler(api_key="k", models=("a",), transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": "no json"}}]})))
    res = _run(ups.upsample("a fox", **KW))
    assert res.upsampler == "none" and res.prompt == "a fox" and "a:" in res.error


def test_no_key_skips_network():
    res = _run(Upsampler(api_key="", models=("a",)).upsample("a fox", **KW))
    assert res.upsampler == "none" and res.error == "NVIDIA_API_KEY not set"


def test_image_is_sent_as_image_url():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    ups = Upsampler(api_key="k", models=("vl",), transport=httpx.MockTransport(handler))
    _run(ups.upsample("walk", image_bytes=b"\x89PNG", **KW))
    content = captured["body"]["messages"][1]["content"]
    assert content[0]["type"] == "image_url" and content[0]["image_url"]["url"].startswith("data:image/png;base64,")


def test_negative_prompts_are_serialized_json():
    for name in ("negative_video.json", "negative_transfer.json"):
        assert isinstance(json.loads(upsampler.load_negative_prompt(name)), dict)
