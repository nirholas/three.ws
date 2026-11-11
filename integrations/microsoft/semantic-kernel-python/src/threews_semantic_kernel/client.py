"""Async HTTP client for the public three.ws API.

This module is the one place in the package that knows the wire format. The
Semantic Kernel plugin wraps these calls in kernel functions, and the Agent
Framework samples reuse the same client, so no framework adapter can drift from
the live API.

Contracts wrapped (all documented at https://three.ws/docs/api-reference):

* ``POST /api/forge`` and ``GET /api/forge?job=<id>``: free text-to-3D
  generation and its job status. No key, IP rate limited.
* ``GET /api/catalog``: the free ready-made asset catalog (CC0 props,
  rigged characters, motion clips).
* ``GET /api/agents``: the caller's own agents. Needs a three.ws API key.
* ``GET /api/agents/public``: the public agent directory. No key.
* ``POST /api/chat``: one message to a three.ws agent, answered over SSE.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

DEFAULT_BASE_URL = "https://three.ws"
FREE_MCP_PATH = "/api/mcp-studio"

TIERS = ("draft", "standard", "high")
ASSET_KINDS = ("object", "character", "animation")

# A long GPU job outlives the odd gateway hiccup, so a poll that hits one of
# these is retried instead of failing the job.
_TRANSIENT_STATUSES = {502, 503, 504}
_TERMINAL_OK = {"done", "succeeded", "completed"}
_TERMINAL_FAIL = {"failed", "error", "cancelled", "canceled"}
# Submitting writes a reference image before the GPU job is queued, which
# takes about 15 s and longer under load.
_SUBMIT_TIMEOUT = 120.0
_MAX_RATE_LIMIT_WAIT = 30.0
_SUBMIT_BACKOFF = (5.0, 15.0)
# Forge masks raw provider errors into stable phrases (api/_lib/provider-job-error.js).
# These name a capacity or timing failure that a fresh attempt can clear. Content
# safety and bad-input failures are never retried.
_RETRYABLE_JOB_ERRORS = ("resources", "too long", "busy", "temporarily unavailable", "hit a snag")


def _retryable_job_error(message: str) -> bool:
    text = (message or "").lower()
    return any(token in text for token in _RETRYABLE_JOB_ERRORS)

ProgressCallback = Callable[[str, float], Awaitable[None] | None]


class ThreeWsError(Exception):
    """Raised for every failure the client can report.

    Attributes:
        message: A user-safe description of what went wrong.
        code: A machine-readable code such as ``rate_limited``, ``needs_key``,
            ``failed``, ``timeout`` or the server's own ``error`` value.
        status: The HTTP status when the failure came from a response.
    """

    def __init__(self, message: str, *, code: str = "error", status: int | None = None) -> None:
        """Create an error with a user-safe message, a code and an optional HTTP status."""
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def viewer_url(glb_url: str, base_url: str = DEFAULT_BASE_URL) -> str:
    """Return the three.ws browser viewer link for a public GLB URL."""
    return f"{base_url.rstrip('/')}/viewer?src={quote(glb_url, safe='')}"


def _describe(err: Exception) -> str:
    """httpx timeouts stringify to "", so fall back to the exception type."""
    return str(err) or type(err).__name__


def _retry_after_seconds(res: httpx.Response) -> float | None:
    raw = res.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def _error_from_response(res: httpx.Response, what: str) -> ThreeWsError:
    code = "error"
    detail = ""
    try:
        body = res.json()
        if isinstance(body, dict):
            code = str(body.get("error") or body.get("code") or code)
            detail = str(body.get("error_description") or body.get("message") or body.get("error") or "")
    except ValueError:
        detail = res.text[:300]
    if res.status_code == 401:
        code = "needs_key"
        detail = detail or "this call needs a three.ws API key (create one at https://three.ws/dashboard/api)"
    elif res.status_code == 429:
        code = "rate_limited"
        retry = res.headers.get("retry-after")
        detail = detail or "rate limited"
        if retry:
            detail = f"{detail} (retry after {retry}s)"
    return ThreeWsError(f"three.ws {what} failed ({res.status_code}): {detail}".rstrip(": "), code=code, status=res.status_code)


class ThreeWsClient:
    """Async client for the three.ws public API.

    Args:
        base_url: The three.ws origin. Override it for a self-hosted deployment.
        api_key: A three.ws API key (``sk_live_...``). Only ``list_my_agents``
            needs one; every other call is free and anonymous. A connector key
            (read and generate, never spend) is the right key for an agent.
        client_handle: The anonymous handle Forge scopes your creations to. A
            random one is made per client when omitted.
        timeout: Per-request timeout in seconds.
        http_client: Bring your own ``httpx.AsyncClient`` (for proxies, retries
            or tests). The client is not closed by ``aclose`` when supplied.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        api_key: str | None = None,
        client_handle: str | None = None,
        timeout: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        """Configure the client; no network call happens until a method runs."""
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.client_handle = client_handle or f"threews-sk-{uuid.uuid4().hex}"
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(
            timeout=timeout,
            headers={"user-agent": "threews-semantic-kernel/0.1 (+https://three.ws)"},
            follow_redirects=True,
        )

    async def __aenter__(self) -> ThreeWsClient:
        """Enter an ``async with`` block."""
        return self

    async def __aexit__(self, *exc: object) -> None:
        """Close the HTTP client when leaving an ``async with`` block."""
        await self.aclose()

    async def aclose(self) -> None:
        """Close the underlying HTTP client if this instance created it."""
        if self._owns_http:
            await self._http.aclose()

    @property
    def mcp_url(self) -> str:
        """The free three.ws 3D Studio MCP endpoint (Streamable HTTP)."""
        return f"{self.base_url}{FREE_MCP_PATH}"

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    async def _get_json(self, path: str, what: str, *, params: dict[str, Any] | None = None, auth: bool = False) -> Any:
        headers = {}
        if auth:
            if not self.api_key:
                raise ThreeWsError(
                    f"three.ws {what} needs an API key: pass api_key or set THREE_WS_API_KEY "
                    "(create one at https://three.ws/dashboard/api)",
                    code="needs_key",
                )
            headers["authorization"] = f"Bearer {self.api_key}"
        try:
            res = await self._http.get(self._url(path), params=params, headers=headers)
        except httpx.HTTPError as err:
            raise ThreeWsError(f"three.ws {what} is unreachable: {_describe(err)}", code="network") from err
        if res.status_code >= 400:
            raise _error_from_response(res, what)
        return res.json()

    # ----- 3D generation -------------------------------------------------

    async def submit_generation(self, prompt: str, *, tier: str = "standard") -> dict[str, Any]:
        """Start a free text-to-3D job and return Forge's submit response.

        The response carries ``job_id`` and ``status`` (usually ``queued``). A
        prompt Forge already generated recently comes back ``done`` at once with
        ``glb_url`` and no job to poll.
        """
        prompt = (prompt or "").strip()
        if len(prompt) < 3:
            raise ThreeWsError("describe the model in at least 3 characters", code="validation_error")
        if tier not in TIERS:
            raise ThreeWsError(f"tier must be one of {', '.join(TIERS)}", code="validation_error")
        rate_limit_waited = False
        for attempt in range(3):
            try:
                res = await self._http.post(
                    self._url("/api/forge"),
                    json={"prompt": prompt, "tier": tier},
                    headers={"x-forge-client": self.client_handle},
                    timeout=_SUBMIT_TIMEOUT,
                )
            except httpx.HTTPError as err:
                raise ThreeWsError(f"three.ws Forge is unreachable: {_describe(err)}", code="network") from err
            if res.status_code in _TRANSIENT_STATUSES and attempt < 2:
                # A 502 here usually means every GPU lane is busy; give one a
                # moment to free up instead of hammering it.
                await asyncio.sleep(_SUBMIT_BACKOFF[attempt])
                continue
            if res.status_code == 429 and not rate_limit_waited:
                retry_after = _retry_after_seconds(res)
                if retry_after is not None and retry_after <= _MAX_RATE_LIMIT_WAIT:
                    rate_limit_waited = True
                    await asyncio.sleep(retry_after)
                    continue
            if res.status_code >= 400:
                raise _error_from_response(res, "Forge generation")
            return res.json()
        raise _error_from_response(res, "Forge generation")

    async def get_job(self, job_id: str) -> dict[str, Any]:
        """Read one Forge job: ``{status, glb_url?, error?, ...}``.

        Adds ``viewer_url`` when the job is done, so a caller can hand a person
        a link that opens the model in the browser.
        """
        if not job_id:
            raise ThreeWsError("job_id is required", code="validation_error")
        last: ThreeWsError | None = None
        for attempt in range(3):
            try:
                res = await self._http.get(self._url("/api/forge"), params={"job": job_id})
            except httpx.HTTPError as err:
                last = ThreeWsError(f"three.ws Forge is unreachable: {_describe(err)}", code="network")
            else:
                if res.status_code in _TRANSIENT_STATUSES:
                    last = _error_from_response(res, "Forge job status")
                elif res.status_code >= 400:
                    raise _error_from_response(res, "Forge job status")
                else:
                    return self._decorate(res.json())
            await asyncio.sleep(1.5 * (attempt + 1))
        raise last or ThreeWsError("three.ws Forge job status is unavailable", code="network")

    def _decorate(self, job: dict[str, Any]) -> dict[str, Any]:
        glb = job.get("glb_url")
        if glb and not job.get("viewer_url"):
            job["viewer_url"] = viewer_url(glb, self.base_url)
        return job

    async def generate_model(
        self,
        prompt: str,
        *,
        tier: str = "standard",
        wait_seconds: float = 240.0,
        poll_interval: float = 5.0,
        on_progress: ProgressCallback | None = None,
        retries: int = 1,
    ) -> dict[str, Any]:
        """Generate a textured GLB from text, waiting up to ``wait_seconds``.

        Returns a dict with ``status`` and ``job_id``. When the model finished
        inside the wait it also has ``glb_url`` and ``viewer_url``. When it did
        not, ``status`` is still ``queued`` or ``running``: call ``get_job``
        with the ``job_id`` later; the job keeps running server-side. Pass
        ``wait_seconds=0`` to return right after submitting.

        A job that fails for a capacity or timing reason (the GPU ran out of
        memory, the engine was busy) is resubmitted up to ``retries`` times
        while the wait lasts. The result then carries ``attempts``.

        Raises:
            ThreeWsError: the prompt was rejected, Forge was rate limited or
                unreachable, or the job failed.
        """
        started = time.monotonic()
        attempt = 0
        while True:
            attempt += 1
            remaining = max(wait_seconds - (time.monotonic() - started), 0.0)
            try:
                job = await self._generate_once(prompt, tier, remaining, poll_interval, on_progress)
            except ThreeWsError as err:
                can_retry = (
                    err.code == "failed"
                    and _retryable_job_error(err.message)
                    and attempt <= retries
                    and time.monotonic() - started < wait_seconds
                )
                if not can_retry:
                    raise
                continue
            if attempt > 1:
                job["attempts"] = attempt
            return job

    async def _generate_once(
        self,
        prompt: str,
        tier: str,
        wait_seconds: float,
        poll_interval: float,
        on_progress: ProgressCallback | None,
    ) -> dict[str, Any]:
        submitted = await self.submit_generation(prompt, tier=tier)
        job_id = submitted.get("job_id")
        status = str(submitted.get("status") or "queued")
        if status in _TERMINAL_OK and submitted.get("glb_url"):
            return self._decorate({**submitted, "status": "done"})
        if not job_id:
            raise ThreeWsError("Forge accepted the prompt but returned no job id", code="failed")

        started = time.monotonic()
        job: dict[str, Any] = {"job_id": job_id, "status": status, "prompt": submitted.get("prompt", prompt)}
        while True:
            elapsed = time.monotonic() - started
            if on_progress is not None:
                maybe = on_progress(status, elapsed)
                if asyncio.iscoroutine(maybe):
                    await maybe
            if elapsed >= wait_seconds:
                return job
            await asyncio.sleep(min(poll_interval, max(wait_seconds - elapsed, 0.1)))
            polled = await self.get_job(job_id)
            status = str(polled.get("status") or status)
            job = {**job, **polled, "job_id": job_id}
            if status in _TERMINAL_OK:
                if not job.get("glb_url"):
                    raise ThreeWsError("Forge finished the job but returned no model URL", code="failed")
                job["status"] = "done"
                return job
            if status in _TERMINAL_FAIL:
                raise ThreeWsError(f"generation failed: {polled.get('error') or status}", code="failed")

    # ----- Asset catalog -------------------------------------------------

    async def search_assets(
        self,
        query: str,
        *,
        kind: str | None = None,
        limit: int = 5,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Search the free three.ws catalog of ready-made 3D assets.

        Args:
            query: Free text over titles, names, tags and categories.
            kind: ``object``, ``character`` or ``animation`` (all when omitted).
            limit: 1 to 50 results.
            offset: Page offset (``next_offset`` from a previous response).
        """
        if kind is not None and kind not in ASSET_KINDS:
            raise ThreeWsError(f"kind must be one of {', '.join(ASSET_KINDS)}", code="validation_error")
        params: dict[str, Any] = {"q": query, "limit": max(1, min(int(limit), 50)), "offset": max(0, int(offset))}
        if kind:
            params["kind"] = kind
        return await self._get_json("/api/catalog", "asset search", params=params)

    # ----- Agents ----------------------------------------------------------

    async def list_my_agents(self) -> list[dict[str, Any]]:
        """List the agents owned by the API key's account (needs ``api_key``)."""
        body = await self._get_json("/api/agents", "list agents", auth=True)
        agents = body.get("agents", []) if isinstance(body, dict) else body
        return [
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "description": a.get("description"),
                "avatar_url": a.get("avatar_url"),
                "page_url": f"{self.base_url}/agents/{a.get('id')}",
                "created_at": a.get("created_at"),
            }
            for a in agents or []
        ]

    async def list_public_agents(self, query: str | None = None, *, limit: int = 10) -> list[dict[str, Any]]:
        """Search the public three.ws agent directory (no key needed)."""
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 48))}
        if query:
            params["q"] = query
        body = await self._get_json("/api/agents/public", "agent directory", params=params)
        return [
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "description": a.get("description"),
                "skills": [s.get("slug") for s in a.get("skills") or [] if isinstance(s, dict)],
                "page_url": f"{self.base_url}{a.get('home_url') or '/agents/' + str(a.get('id'))}",
            }
            for a in body.get("agents", [])
        ]

    async def message_agent(
        self,
        message: str,
        *,
        agent_id: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Send one message to a three.ws agent and return its full reply.

        Streams the real SSE answer from ``/api/chat`` and joins the text
        chunks. Omit ``agent_id`` to talk to the default three.ws guide.

        Returns:
            ``{"reply": str, "model": str | None, "provider": str | None,
            "actions": list}``
        """
        message = (message or "").strip()
        if not message:
            raise ThreeWsError("message is empty", code="validation_error")
        payload: dict[str, Any] = {"message": message, "history": history or []}
        if agent_id:
            payload["agentId"] = agent_id
        headers = {"accept": "text/event-stream"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"

        chunks: list[str] = []
        done: dict[str, Any] | None = None
        try:
            async with self._http.stream(
                "POST", self._url("/api/chat"), json=payload, headers=headers, timeout=120.0
            ) as res:
                if res.status_code >= 400:
                    await res.aread()
                    raise _error_from_response(res, "agent chat")
                async for line in res.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw:
                        continue
                    try:
                        event = json.loads(raw)
                    except ValueError:
                        continue
                    kind = event.get("type")
                    if kind in ("chunk", "content", "delta") and isinstance(event.get("text"), str):
                        chunks.append(event["text"])
                    elif kind == "error":
                        raise ThreeWsError(f"agent chat failed: {event.get('error') or 'stream error'}", code="failed")
                    elif kind == "done":
                        done = event
        except httpx.HTTPError as err:
            raise ThreeWsError(f"three.ws chat is unreachable: {_describe(err)}", code="network") from err
        if done is None:
            raise ThreeWsError("agent chat stream ended without a done event", code="failed")
        reply = "".join(chunks).strip() or str(done.get("reply") or "").strip()
        return {
            "reply": reply,
            "model": done.get("model"),
            "provider": done.get("provider"),
            "actions": done.get("actions") or [],
        }
