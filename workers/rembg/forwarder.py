"""Traffic split from the CPU rembg service to the Triton GPU lane.

The CPU service stays the one URL every caller knows (model-trellis, the
three.ws API). With ``TRITON_FORWARD_URL`` set, ``TRITON_FORWARD_PERCENT`` of
``POST /remove`` submits are handed to the GPU lane, which answers with its own
task id. Both lanes write task records to the same bucket (task_store.py), so
the caller's polls keep hitting the CPU URL and are answered from the shared
record wherever the job ran. Promotion is a config change: raise the percent.

A forward that fails for any reason falls back to processing locally, so the
split can never turn a GPU-lane outage into a caller-visible error.
"""

from __future__ import annotations

import uuid

import httpx

FORWARD_TIMEOUT_S = 15.0


class ForwardError(RuntimeError):
    """The GPU lane did not accept the job; the caller should run it locally."""


def forward_percent(raw: str | None) -> float:
    """Parse the env value, clamped to 0..100. Anything unparseable is 0, so a
    typo turns the split off rather than sending every job somewhere."""
    try:
        value = float(raw) if raw not in (None, "") else 0.0
    except ValueError:
        return 0.0
    if value != value:  # NaN
        return 0.0
    return min(max(value, 0.0), 100.0)


def should_forward(url: str | None, percent: float, draw: float) -> bool:
    """``draw`` is uniform in [0, 1); passing it in keeps the rule testable."""
    return bool(url) and percent > 0.0 and draw * 100.0 < percent


async def forward_submit(client: httpx.AsyncClient, base_url: str, api_key: str, body: dict) -> dict:
    """Submit the job to the GPU lane and return its ``{task_id, status, model}``."""
    try:
        resp = await client.post(
            f"{base_url.rstrip('/')}/remove",
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=FORWARD_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        raise ForwardError(f"GPU lane unreachable: {type(exc).__name__}") from exc
    if resp.status_code != 202:
        raise ForwardError(f"GPU lane answered HTTP {resp.status_code}")
    try:
        payload = resp.json()
        task_id = str(uuid.UUID(payload["task_id"]))
    except (ValueError, KeyError, TypeError) as exc:
        raise ForwardError("GPU lane returned a malformed submit response") from exc
    return {"task_id": task_id, "status": payload.get("status", "queued"), "model": payload.get("model")}
