"""Native Semantic Kernel plugin exposing three.ws as kernel functions.

Each function returns a compact JSON string, which is what a chat model reads
back after a tool call. Failures come back as ``{"ok": false, "error": ...}``
instead of raising, so the model can explain the problem or retry instead of
the whole turn failing.
"""

from __future__ import annotations

import json
import os
from typing import Annotated, Any

from semantic_kernel.functions import kernel_function

from .client import ThreeWsClient, ThreeWsError


def _ok(data: Any) -> str:
    return json.dumps({"ok": True, **data} if isinstance(data, dict) else {"ok": True, "result": data})


def _fail(err: ThreeWsError) -> str:
    return json.dumps({"ok": False, "error": err.message, "code": err.code})


class ThreeWsPlugin:
    """three.ws 3D generation, asset search and agent messaging for Semantic Kernel.

    Add it to a kernel with ``kernel.add_plugin(ThreeWsPlugin(), "threews")``.

    Args:
        client: An existing ``ThreeWsClient``. When omitted one is created from
            ``base_url`` and ``api_key``.
        base_url: The three.ws origin (``THREE_WS_BASE_URL`` or https://three.ws).
        api_key: A three.ws API key (``THREE_WS_API_KEY``). Only
            ``list_my_agents`` needs it.
        generation_wait_seconds: How long ``generate_3d_model`` waits for the
            model before handing back a job id to check later.
    """

    def __init__(
        self,
        client: ThreeWsClient | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        generation_wait_seconds: float = 240.0,
    ) -> None:
        """Create the plugin around a new or supplied ``ThreeWsClient``."""
        self.client = client or ThreeWsClient(
            base_url or os.environ.get("THREE_WS_BASE_URL") or "https://three.ws",
            api_key=api_key or os.environ.get("THREE_WS_API_KEY") or None,
        )
        self.generation_wait_seconds = generation_wait_seconds

    @kernel_function(
        name="generate_3d_model",
        description=(
            "Generate a textured, downloadable 3D model (GLB) from a text description of one object, "
            "character or creature. Free. Waits for the model and returns glb_url and viewer_url; if it "
            "is still running, returns a job_id to pass to get_3d_job_status."
        ),
    )
    async def generate_3d_model(
        self,
        prompt: Annotated[str, "Description of the single object to model, e.g. 'a weathered bronze lantern'."],
        tier: Annotated[str, "Detail level: draft (fastest), standard (default) or high (slowest, best)."] = "standard",
    ) -> str:
        """Generate a GLB from text and return its URLs or a pending job id."""
        try:
            job = await self.client.generate_model(prompt, tier=tier, wait_seconds=self.generation_wait_seconds)
        except ThreeWsError as err:
            return _fail(err)
        return _ok(_job_view(job))

    @kernel_function(
        name="get_3d_job_status",
        description=(
            "Check a 3D generation job started by generate_3d_model. Returns status (queued, running, "
            "done, failed) and, once done, glb_url and viewer_url."
        ),
    )
    async def get_3d_job_status(
        self,
        job_id: Annotated[str, "The job_id returned by generate_3d_model."],
    ) -> str:
        """Return the current state of one generation job."""
        try:
            job = await self.client.get_job(job_id)
        except ThreeWsError as err:
            return _fail(err)
        return _ok(_job_view({**job, "job_id": job_id}))

    @kernel_function(
        name="find_3d_asset",
        description=(
            "Search thousands of free, ready-made 3D assets on three.ws (CC0 props and objects, rigged "
            "characters, motion clips). Check here before generating a model from scratch."
        ),
    )
    async def find_3d_asset(
        self,
        query: Annotated[str, "What to look for, e.g. 'wooden chair' or 'brass lantern'."],
        kind: Annotated[str, "object, character or animation; empty for all kinds."] = "",
        limit: Annotated[int, "How many results to return, 1 to 20."] = 5,
    ) -> str:
        """Search the asset catalog and return the best matches."""
        try:
            body = await self.client.search_assets(query, kind=kind or None, limit=max(1, min(limit, 20)))
        except ThreeWsError as err:
            return _fail(err)
        items = [
            {
                "id": i.get("id"),
                "title": i.get("title"),
                "kind": i.get("kind"),
                "license": i.get("license"),
                "glb_url": i.get("url"),
                "thumbnail_url": i.get("thumb"),
                "tags": (i.get("tags") or [])[:8],
            }
            for i in body.get("items", [])
        ]
        return _ok({"matched": body.get("matched", len(items)), "relaxed": bool(body.get("relaxed")), "items": items})

    @kernel_function(
        name="list_my_agents",
        description=(
            "List the three.ws AI agents owned by the configured account (needs a three.ws API key). "
            "Without a key, search_public_agents finds public ones instead."
        ),
    )
    async def list_my_agents(self) -> str:
        """List the account's agents."""
        try:
            agents = await self.client.list_my_agents()
        except ThreeWsError as err:
            return _fail(err)
        return _ok({"count": len(agents), "agents": agents})

    @kernel_function(
        name="search_public_agents",
        description="Search the public three.ws agent directory by name or description. Free, no key.",
    )
    async def search_public_agents(
        self,
        query: Annotated[str, "Words to match against agent names and descriptions; empty for popular agents."] = "",
        limit: Annotated[int, "How many agents to return, 1 to 20."] = 5,
    ) -> str:
        """Search public agents."""
        try:
            agents = await self.client.list_public_agents(query or None, limit=max(1, min(limit, 20)))
        except ThreeWsError as err:
            return _fail(err)
        return _ok({"count": len(agents), "agents": agents})

    @kernel_function(
        name="message_agent",
        description=(
            "Send a message to a three.ws AI agent and return its reply. Omit agent_id to ask the "
            "default three.ws guide."
        ),
    )
    async def message_agent(
        self,
        message: Annotated[str, "The message to send."],
        agent_id: Annotated[str, "The agent's id from list_my_agents or search_public_agents; empty for the guide."] = "",
    ) -> str:
        """Message an agent and return its reply."""
        try:
            answer = await self.client.message_agent(message, agent_id=agent_id or None)
        except ThreeWsError as err:
            return _fail(err)
        return _ok({"reply": answer["reply"], "model": answer.get("model")})


def _job_view(job: dict[str, Any]) -> dict[str, Any]:
    view = {"status": job.get("status"), "job_id": job.get("job_id")}
    for key in ("glb_url", "viewer_url", "prompt", "tier", "backend", "error"):
        if job.get(key):
            view[key] = job[key]
    if view["status"] in ("queued", "running"):
        view["next_step"] = "call get_3d_job_status with this job_id in about 30 seconds"
    return view
