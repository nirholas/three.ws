"""Poe server bot that turns a chat message into a textured 3D model (GLB).

It wraps the free, auth-free three.ws Forge lane (``POST /api/forge``, polled on
``GET /api/forge?job=``) through the shared stdlib client. Progress is streamed
as text while the job runs, and the final message carries the GLB link, a
browser viewer link and, when Forge returns one, an inline preview image.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import AsyncIterable
from urllib.parse import quote

import fastapi_poe as fp

from three_ws_client import TIERS, ThreeWSClient, ThreeWSError

BASE_URL = os.environ.get("THREEWS_BASE_URL", "https://three.ws")
POLL_INTERVAL = float(os.environ.get("FORGE_POLL_INTERVAL", "3"))
POLL_TIMEOUT = float(os.environ.get("FORGE_POLL_TIMEOUT", "300"))

INTRO = "Describe one object and I will forge a textured 3D model (GLB). Add `tier: high` for more detail, or `tier: draft` (default) for speed."

_TIER_RE = re.compile(r"\btier\s*[:=]\s*(draft|standard|high)\b", re.IGNORECASE)


def parse_request(text: str) -> tuple[str, str]:
    """Split a chat message into (prompt, tier). Tier defaults to draft."""
    match = _TIER_RE.search(text or "")
    tier = match.group(1).lower() if match else "draft"
    prompt = _TIER_RE.sub("", text or "").strip(" \n\t,;")
    return prompt, tier


def viewer_url(glb_url: str, base_url: str = BASE_URL) -> str:
    return f"{base_url.rstrip('/')}/viewer?src={quote(glb_url, safe='')}"


def friendly_error(exc: ThreeWSError) -> str:
    if exc.code == "timeout":
        return "The free Forge lane is busy right now. Try again in a minute, or use `tier: draft`."
    if exc.status == 429:
        return "The free rate limit was reached. Wait a few minutes and send the prompt again."
    if exc.code == "unreachable":
        return f"I could not reach {BASE_URL}. Please try again shortly."
    return f"Forge could not finish: {exc}"


class ForgeBot(fp.PoeBot):
    def __init__(self, base_url: str = BASE_URL, **kwargs):
        super().__init__(**kwargs)
        self.base_url = base_url

    async def get_response(self, request: fp.QueryRequest) -> AsyncIterable[fp.PartialResponse]:
        last = request.query[-1].content if request.query else ""
        prompt, tier = parse_request(last)
        if len(prompt) < 3:
            yield fp.PartialResponse(text="Describe one subject in at least 3 characters, for example: a small wooden chair.")
            return

        client = ThreeWSClient(self.base_url, timeout=90, client_handle=f"poe-{request.user_id or 'anon'}"[:60])
        yield fp.PartialResponse(text=f"Forging **{prompt}** (tier: {tier}).\n\n")
        try:
            submission = await asyncio.to_thread(client.submit_text_to_3d, prompt, tier=tier)
            job_id = submission.get("job_id")
            if not job_id:
                yield fp.PartialResponse(text=self._result_text(submission, prompt), is_replace_response=False)
                return
            started = time.monotonic()
            last_status = ""
            while True:
                elapsed = time.monotonic() - started
                if elapsed > POLL_TIMEOUT:
                    raise ThreeWSError(f"Generation timed out after {int(elapsed)}s.", code="timeout")
                try:
                    job = await asyncio.to_thread(client._request, "GET", f"/api/forge?job={quote(job_id)}")
                except ThreeWSError as exc:
                    if exc.status in (502, 503, 504):
                        await asyncio.sleep(POLL_INTERVAL)
                        continue
                    raise
                status = job.get("status") or "running"
                if status == "done" and job.get("glb_url"):
                    yield fp.PartialResponse(text=self._result_text(job, prompt), is_replace_response=False)
                    return
                if status == "failed":
                    raise ThreeWSError(job.get("error") or "Generation failed.", code="failed")
                if status != last_status:
                    label = "Waiting for a free GPU" if status == "queued" else "Generating mesh and textures"
                    yield fp.PartialResponse(text=f"{label}...\n\n")
                    last_status = status
                await asyncio.sleep(POLL_INTERVAL)
        except ThreeWSError as exc:
            yield fp.PartialResponse(text=f"**{friendly_error(exc)}**")

    def _result_text(self, job: dict, prompt: str) -> str:
        glb = job["glb_url"]
        lines = []
        preview = job.get("preview_image_url") or job.get("preview_url")
        if isinstance(preview, str) and preview.startswith("https://"):
            lines.append(f"![{prompt}]({preview})\n")
        lines.append(f"**Done.** [Open in the three.ws viewer]({viewer_url(glb, self.base_url)}) or [download the GLB]({glb}).")
        return "\n".join(lines)

    async def get_settings(self, setting: fp.SettingsRequest) -> fp.SettingsResponse:
        return fp.SettingsResponse(
            allow_attachments=False,
            introduction_message=INTRO,
            server_bot_dependencies={},
        )


def build_app(access_key: str = "", allow_without_key: bool = False):
    return fp.make_app(ForgeBot(), access_key=access_key, allow_without_key=allow_without_key)


if __name__ == "__main__":
    key = os.environ.get("POE_ACCESS_KEY", "")
    fp.run(ForgeBot(), access_key=key, allow_without_key=not key)
