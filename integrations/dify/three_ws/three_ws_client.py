"""Minimal client for the free three.ws studio MCP server.

The server speaks MCP over Streamable HTTP, but every tool this plugin uses is
a single stateless JSON-RPC `tools/call`, so a plain HTTPS POST is enough and
the plugin needs no MCP library. The server is anonymous: no key, no account,
no payment path. It rate-limits generations per IP.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

import httpx

ENDPOINT = "https://three.ws/api/mcp-studio"
USER_AGENT = "three-ws-dify-plugin/0.1.0 (+https://github.com/nirholas/three.ws)"

# One HTTP call can block while the server waits on its generation queue.
CALL_TIMEOUT = httpx.Timeout(connect=15.0, read=180.0, write=30.0, pool=15.0)
# Total time a generation may take, polling included. Kept under the plugin's
# MAX_REQUEST_TIMEOUT (600 s in main.py) so the tool reports a resumable job id
# instead of being killed by the runner.
GENERATION_BUDGET_S = 540.0
POLL_INTERVAL_S = 8.0


class ThreeWsError(Exception):
    """A failure the user can act on. The message says what to do next."""


class ThreeWsPending(ThreeWsError):
    """The generation outlived the time budget. It keeps running on three.ws."""

    def __init__(self, message: str, job_id: str, viewer_url: str):
        super().__init__(message)
        self.job_id = job_id
        self.viewer_url = viewer_url


def _parse_body(response: httpx.Response) -> dict[str, Any]:
    """The server answers with JSON, or with a single SSE `data:` event."""
    text = response.text.strip()
    if response.headers.get("content-type", "").startswith("text/event-stream"):
        payload = ""
        for line in text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
        text = payload
    try:
        return json.loads(text)
    except ValueError as exc:
        raise ThreeWsError(
            f"three.ws returned an unreadable response (HTTP {response.status_code}). Try again in a minute."
        ) from exc


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Call one studio tool and return its structured result.

    Raises ThreeWsError with an actionable message on rate limits, tool errors,
    and transport failures.
    """
    request = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    try:
        response = httpx.post(
            ENDPOINT,
            json=request,
            headers={
                "Accept": "application/json, text/event-stream",
                "User-Agent": USER_AGENT,
            },
            timeout=CALL_TIMEOUT,
        )
    except httpx.TimeoutException as exc:
        raise ThreeWsError("three.ws did not answer in time. Try again in a minute.") from exc
    except httpx.HTTPError as exc:
        raise ThreeWsError(f"Could not reach three.ws: {exc}. Check the network and try again.") from exc

    if response.status_code == 429:
        retry = response.headers.get("retry-after")
        wait = f" Try again in {retry} seconds." if retry else " Try again later."
        raise ThreeWsError("The free three.ws studio is rate limited for this IP." + wait)
    if response.status_code >= 500:
        raise ThreeWsError(f"three.ws had a server error (HTTP {response.status_code}). Try again in a minute.")

    body = _parse_body(response)
    error = body.get("error")
    if error:
        data = error.get("data") or {}
        if data.get("reason") == "rate_limited":
            retry = data.get("retryAfter") or data.get("retry_after")
            wait = f" Try again in {retry} seconds." if retry else " Try again later."
            raise ThreeWsError("The free three.ws studio is rate limited for this IP." + wait)
        raise ThreeWsError(f"three.ws rejected the request: {error.get('message', 'unknown error')}")

    result = body.get("result") or {}
    if result.get("isError"):
        texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
        raise ThreeWsError(" ".join(t for t in texts if t) or f"{name} failed on three.ws.")

    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    for item in result.get("content", []):
        if item.get("type") == "text":
            try:
                parsed = json.loads(item["text"])
            except (ValueError, KeyError):
                continue
            if isinstance(parsed, dict):
                return parsed
    raise ThreeWsError(f"three.ws returned no result for {name}. Try again in a minute.")


def _is_pending(result: dict[str, Any]) -> bool:
    return result.get("status") == "pending" and bool(result.get("job_id") or result.get("jobId"))


def _poll_delay(result: dict[str, Any]) -> float:
    """Wait about the ETA the server reports, within sane bounds."""
    try:
        eta = float(result.get("eta_seconds") or result.get("etaRemainingSeconds") or 0)
    except (TypeError, ValueError):
        eta = 0.0
    return min(max(eta, POLL_INTERVAL_S), 30.0)


def run_generation(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Start a generation and poll `check_job` until it finishes.

    forge_avatar can run out of server time between its mesh and rig stages; a
    pending result then carries `next: "rig"`, and this function rigs the mesh
    itself once it lands, so the caller always gets what it asked for.

    Raises ThreeWsPending if the job is still running when the time budget runs
    out. The job keeps going on three.ws and its viewer link opens the model the
    moment it is ready.
    """
    arguments = {**arguments, "idempotency_key": arguments.get("idempotency_key") or str(uuid.uuid4())}
    deadline = time.monotonic() + GENERATION_BUDGET_S
    result = call_tool(name, arguments)
    rig_after = False
    while True:
        while _is_pending(result):
            job_id = str(result.get("job_id") or result.get("jobId"))
            rig_after = rig_after or result.get("next") == "rig"
            delay = _poll_delay(result)
            if time.monotonic() + delay > deadline:
                viewer = str(result.get("viewer_url") or f"https://three.ws/viewer?job={job_id}")
                raise ThreeWsPending(
                    f"three.ws is still working on this (job {job_id}). It keeps running: open {viewer} and the"
                    " model appears there the moment it is ready.",
                    job_id,
                    viewer,
                )
            time.sleep(delay)
            result = call_tool("check_job", {"job_id": job_id})
        if result.get("status") == "error":
            raise ThreeWsError(str(result.get("error") or "The generation failed on three.ws. Try again."))
        mesh = model_urls(result).get("glb_url")
        if not rig_after or not mesh:
            return result
        rig_after = False
        result = call_tool("rig_mesh", {"glb_url": mesh, "idempotency_key": str(uuid.uuid4())})


def model_urls(result: dict[str, Any]) -> dict[str, str]:
    """Pick the links a finished generation carries (snake_case first, camelCase twins as fallback)."""
    pick = lambda *keys: next((str(result[k]) for k in keys if result.get(k)), "")  # noqa: E731
    urls = {
        "glb_url": pick("glb_url", "glbUrl"),
        "viewer_url": pick("viewer_url", "viewerUrl"),
        "ar_url": pick("arUrl"),
        "poster_png_url": pick("poster_png_url"),
        "embed_html": pick("embed_html"),
    }
    return {k: v for k, v in urls.items() if v}


def download(url: str, max_bytes: int = 64 * 1024 * 1024) -> bytes:
    """Fetch a generated GLB so a workflow can pass it on as a file."""
    try:
        with httpx.stream("GET", url, headers={"User-Agent": USER_AGENT}, timeout=CALL_TIMEOUT, follow_redirects=True) as r:
            r.raise_for_status()
            chunks: list[bytes] = []
            size = 0
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ThreeWsError(
                        f"The model is larger than {max_bytes // (1024 * 1024)} MB, so it was not attached. Use the GLB URL instead."
                    )
                chunks.append(chunk)
            return b"".join(chunks)
    except httpx.HTTPError as exc:
        raise ThreeWsError(f"Could not download the model file: {exc}. Use the GLB URL instead.") from exc
