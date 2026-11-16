"""Prompt upsampling: turn a one-line idea into the structured JSON caption Cosmos 3 was trained on.

Cosmos 3 was trained on `json.dumps(...)` captions, so a terse prompt produces a
noticeably weaker clip than the same idea expanded into the upstream schema.
This module reproduces upstream `cosmos_framework.inference.prompt_upsampling`
(`build_t2v_prompt_text`, `extract_json_object`) and sends the request to the
NVIDIA API Catalog's OpenAI-compatible chat endpoint.

Order: each model in UPSAMPLER_MODELS is tried in turn. If all fail (no key,
quota, outage, unparsable JSON) the caller falls back to the plain prompt with
the pipeline's resolution and duration templates, and records upsampler="none"
so the result says honestly which path produced it.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Optional

import httpx

log = logging.getLogger("cosmos.upsampler")

PROMPTING_DIR = Path(__file__).with_name("prompting")

# Upstream RESOLUTION_RATIO_DICT verbatim, injected into the
# template so the upsampler copies valid sizes back.
RESOLUTION_RATIO_DICT: dict[str, dict[str, dict[str, int]]] = {
    "256": {
        "1,1": {"W": 256, "H": 256},
        "4,3": {"W": 320, "H": 256},
        "3,4": {"W": 256, "H": 320},
        "16,9": {"W": 320, "H": 192},
        "9,16": {"W": 192, "H": 320},
    },
    "480": {
        "1,1": {"W": 640, "H": 640},
        "4,3": {"W": 736, "H": 544},
        "3,4": {"W": 544, "H": 736},
        "16,9": {"W": 832, "H": 480},
        "9,16": {"W": 480, "H": 832},
    },
    "720": {
        "1,1": {"W": 960, "H": 960},
        "4,3": {"W": 1104, "H": 832},
        "3,4": {"W": 832, "H": 1104},
        "16,9": {"W": 1280, "H": 720},
        "9,16": {"W": 720, "H": 1280},
    },
    "768": {
        "1,1": {"W": 1024, "H": 1024},
        "4,3": {"W": 1184, "H": 880},
        "3,4": {"W": 880, "H": 1184},
        "16,9": {"W": 1360, "H": 768},
        "9,16": {"W": 768, "H": 1360},
    },
}

DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
# Both are vision-capable, so image mode can show the start frame. Measured on
# 2026-11-16: super-vl 18.2 s, nano-omni 14.3 s for a full schema-valid caption.
DEFAULT_MODELS = (
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
)
IMAGE_INTRO = "Given the attached starting frame image and the user's natural-language request below"
TEXT_INTRO = "Given the user's natural-language request below"
IMAGE_NOTE = (
    "\nIMPORTANT - IMAGE INPUT: The attached image is the first frame of the video. Use it as visual "
    "ground truth for subject appearance, setting, lighting, and colors. The natural-language request "
    "primarily describes temporal/action intent. Your JSON must be consistent with what is visible in the image.\n"
)
SYSTEM_MESSAGE = {"role": "system", "content": [{"type": "text", "text": "You are a helpful assistant."}]}


def _read(name: str) -> str:
    return (PROMPTING_DIR / name).read_text(encoding="utf-8").rstrip("\n")


PROMPT_TEMPLATE = Template(_read("t2v_i2v_video_prompt.txt"))
JSON_TEMPLATE = _read("t2v_i2v_video_json_schema.json")


def load_negative_prompt(filename: str) -> str:
    """The upstream negative prompt files hold a JSON object; the pipeline takes it serialized."""
    data = json.loads((PROMPTING_DIR / filename).read_text(encoding="utf-8"))
    return json.dumps(data, ensure_ascii=True)


def build_nl_description(prompt: str, *, resolution: str, aspect_ratio: str, duration: str, fps: int) -> str:
    params = [f"resolution {resolution}", f"aspect_ratio {aspect_ratio}", f"duration {duration}", f"fps {fps}"]
    return f"{prompt.strip()}\n\nOutput parameters: {', '.join(params)}."


def build_prompt_text(
    prompt: str, *, resolution: str, aspect_ratio: str, duration: str, fps: int, image_conditioned: bool
) -> str:
    return PROMPT_TEMPLATE.substitute(
        image_note=IMAGE_NOTE if image_conditioned else "",
        intro=IMAGE_INTRO if image_conditioned else TEXT_INTRO,
        json_template=JSON_TEMPLATE,
        nl_description=build_nl_description(
            prompt, resolution=resolution, aspect_ratio=aspect_ratio, duration=duration, fps=fps
        ),
        resolution_ratio_dict=json.dumps(RESOLUTION_RATIO_DICT, indent=2),
    )


def build_messages(prompt_text: str, image_bytes: Optional[bytes], image_mime: str = "image/png") -> list[dict]:
    content: list[dict] = []
    if image_bytes:
        encoded = base64.b64encode(image_bytes).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{encoded}"}})
    content.append({"type": "text", "text": prompt_text})
    return [SYSTEM_MESSAGE, {"role": "user", "content": content}]


_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def extract_json_object(text: str) -> dict:
    """Upstream `extract_json_object`, plus a last-resort outermost-brace scan for chatty replies."""
    cleaned = (text or "").strip()
    fence = _FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("upsampler reply holds no JSON object")
        parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("upsampler reply JSON must be an object")
    return parsed


def force_output_parameters(caption: dict, *, height: int, width: int, aspect_ratio: str, duration: str, fps: int) -> dict:
    """The model is told to copy these back; enforce them so a stray value can never desync the caption."""
    caption = dict(caption)
    caption["resolution"] = {"H": height, "W": width}
    caption["aspect_ratio"] = aspect_ratio
    caption["duration"] = duration
    caption["fps"] = fps
    return caption


@dataclass
class UpsampleResult:
    prompt: str  # what the pipeline receives
    upsampler: str  # model id, or "none" when the plain prompt is used
    seconds: float
    caption: Optional[dict] = None
    error: Optional[str] = None

    @property
    def structured(self) -> bool:
        return self.caption is not None


class Upsampler:
    def __init__(
        self,
        api_key: Optional[str] = None,
        models: Optional[tuple[str, ...]] = None,
        endpoint: Optional[str] = None,
        timeout: float = 60.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.api_key = api_key if api_key is not None else os.environ.get("NVIDIA_API_KEY", "").strip()
        env_models = tuple(m.strip() for m in os.environ.get("UPSAMPLER_MODELS", "").split(",") if m.strip())
        self.models = models or env_models or DEFAULT_MODELS
        self.endpoint = endpoint or os.environ.get("UPSAMPLER_ENDPOINT", DEFAULT_ENDPOINT)
        self.timeout = timeout
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def _call(self, client: httpx.AsyncClient, model: str, messages: list[dict]) -> str:
        res = await client.post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 4096,
                "temperature": 0.7,
                "top_p": 0.8,
                # Reasoning models otherwise spend the whole token budget thinking.
                "chat_template_kwargs": {"enable_thinking": False},
            },
        )
        if res.status_code != 200:
            raise RuntimeError(f"{model} returned HTTP {res.status_code}: {res.text[:200]}")
        body = res.json()
        choice = (body.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content")
        if not content:
            raise RuntimeError(f"{model} returned an empty reply (finish_reason={choice.get('finish_reason')})")
        return content

    async def upsample(
        self,
        prompt: str,
        *,
        resolution: str,
        aspect_ratio: str,
        height: int,
        width: int,
        duration: str,
        fps: int,
        image_bytes: Optional[bytes] = None,
        image_mime: str = "image/png",
    ) -> UpsampleResult:
        started = time.monotonic()
        if not self.configured:
            return UpsampleResult(prompt=prompt, upsampler="none", seconds=0.0, error="NVIDIA_API_KEY not set")

        prompt_text = build_prompt_text(
            prompt,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            duration=duration,
            fps=fps,
            image_conditioned=image_bytes is not None,
        )
        messages = build_messages(prompt_text, image_bytes, image_mime)
        errors: list[str] = []
        async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
            for model in self.models:
                try:
                    reply = await self._call(client, model, messages)
                    caption = force_output_parameters(
                        extract_json_object(reply),
                        height=height,
                        width=width,
                        aspect_ratio=aspect_ratio,
                        duration=duration,
                        fps=fps,
                    )
                    return UpsampleResult(
                        prompt=json.dumps(caption, ensure_ascii=True),
                        upsampler=model,
                        seconds=round(time.monotonic() - started, 2),
                        caption=caption,
                    )
                except (httpx.HTTPError, RuntimeError, ValueError) as exc:
                    log.warning("upsampler %s failed: %s", model, exc)
                    errors.append(f"{model}: {exc}"[:240])
        return UpsampleResult(
            prompt=prompt,
            upsampler="none",
            seconds=round(time.monotonic() - started, 2),
            error="; ".join(errors),
        )
