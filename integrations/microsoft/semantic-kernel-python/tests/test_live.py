"""Live tests: every call goes to the real three.ws API, nothing is mocked.

Set THREE_WS_BASE_URL to test a different deployment. ``-m "not slow"`` skips
the one test that runs a real GPU generation (a few minutes).
"""

from __future__ import annotations

import json
import os

import httpx
import pytest
from semantic_kernel import Kernel
from semantic_kernel.functions import KernelArguments

from threews_semantic_kernel import (
    ThreeWsClient,
    ThreeWsError,
    ThreeWsPlugin,
    create_three_ws_mcp_plugin,
    three_ws_mcp_url,
)

BASE = os.environ.get("THREE_WS_BASE_URL", "https://three.ws")


@pytest.fixture
async def client():
    async with ThreeWsClient(BASE) as c:
        yield c


@pytest.fixture
def kernel(client):
    k = Kernel()
    k.add_plugin(ThreeWsPlugin(client), plugin_name="threews")
    return k


async def invoke(kernel: Kernel, name: str, **args) -> dict:
    result = await kernel.invoke(plugin_name="threews", function_name=name, arguments=KernelArguments(**args))
    return json.loads(str(result))


def test_plugin_exposes_described_functions(kernel):
    plugin = kernel.get_plugin("threews")
    names = set(plugin.functions)
    assert names == {
        "generate_3d_model",
        "get_3d_job_status",
        "find_3d_asset",
        "list_my_agents",
        "search_public_agents",
        "message_agent",
    }
    for fn in plugin.functions.values():
        assert fn.description and len(fn.description) > 40


async def test_find_3d_asset_returns_real_glbs(kernel):
    out = await invoke(kernel, "find_3d_asset", query="lantern", kind="object", limit=3)
    assert out["ok"] is True
    assert out["items"], out
    first = out["items"][0]
    assert first["kind"] == "object"
    assert first["glb_url"].startswith("https://") and first["glb_url"].endswith(".glb")
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        head = await http.head(first["glb_url"])
    assert head.status_code == 200


async def test_find_3d_asset_rejects_unknown_kind(kernel):
    out = await invoke(kernel, "find_3d_asset", query="chair", kind="vehicle")
    assert out == {"ok": False, "error": "kind must be one of object, character, animation", "code": "validation_error"}


async def test_search_public_agents(kernel):
    out = await invoke(kernel, "search_public_agents", query="", limit=3)
    assert out["ok"] is True
    assert 1 <= out["count"] <= 3
    agent = out["agents"][0]
    assert agent["id"] and agent["page_url"].startswith(BASE + "/agents/")


async def test_list_my_agents_without_key_explains_how_to_get_one(kernel):
    out = await invoke(kernel, "list_my_agents")
    assert out["ok"] is False
    assert out["code"] == "needs_key"
    assert "dashboard/api" in out["error"]


async def test_list_my_agents_with_a_revoked_key_is_a_real_401():
    async with ThreeWsClient(BASE, api_key="sk_" + "live_thisKeyDoesNotExist000000000000") as c:
        with pytest.raises(ThreeWsError) as info:
            await c.list_my_agents()
    assert info.value.status == 401
    assert info.value.code == "needs_key"


@pytest.mark.skipif(not os.environ.get("THREE_WS_API_KEY"), reason="THREE_WS_API_KEY not set")
async def test_list_my_agents_with_key():
    async with ThreeWsClient(BASE, api_key=os.environ["THREE_WS_API_KEY"]) as c:
        agents = await c.list_my_agents()
    assert isinstance(agents, list)
    for a in agents:
        assert a["id"] and a["page_url"].endswith(a["id"])


async def test_message_agent_returns_a_real_reply(kernel):
    out = await invoke(kernel, "message_agent", message="In one short sentence, what is a GLB file?")
    assert out["ok"] is True
    assert len(out["reply"]) > 10
    assert out["model"]


async def test_get_job_status_for_an_unknown_job_is_an_error(kernel):
    out = await invoke(kernel, "get_3d_job_status", job_id="not-a-real-job")
    assert out["ok"] is False
    assert out["error"]


async def test_generate_rejects_a_too_short_prompt(kernel):
    out = await invoke(kernel, "generate_3d_model", prompt="a")
    assert out["ok"] is False and out["code"] == "validation_error"


async def test_generation_submits_and_returns_a_pollable_job(client):
    job = await client.generate_model("a small carved wooden owl figurine", tier="draft", wait_seconds=0)
    assert job["job_id"] or job.get("glb_url")
    if job["status"] != "done":
        polled = await client.get_job(job["job_id"])
        assert polled["status"] in {"queued", "running", "done"}


@pytest.mark.slow
async def test_generate_3d_model_end_to_end(kernel):
    out = await invoke(kernel, "generate_3d_model", prompt="a weathered bronze ship's lantern", tier="draft")
    assert out["ok"] is True, out
    if out["status"] != "done":
        out = await invoke(kernel, "get_3d_job_status", job_id=out["job_id"])
    assert out["status"] == "done", out
    assert out["glb_url"].startswith("https://")
    assert out["viewer_url"].startswith(BASE + "/viewer?src=")
    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as http:
        res = await http.get(out["glb_url"])
    assert res.status_code == 200
    assert res.content[:4] == b"glTF"


@pytest.mark.parametrize(
    ("message", "retryable"),
    [
        ("The engine ran out of resources. Try again with a simpler request.", True),
        ("The engine took too long, please try again.", True),
        ("The 3D engine is busy right now, wait a moment and try again.", True),
        ("This was flagged by content safety. Try a different prompt or photo.", False),
        ("", False),
    ],
)
def test_only_capacity_and_timing_failures_are_retried(message, retryable):
    from threews_semantic_kernel.client import _retryable_job_error

    assert _retryable_job_error(message) is retryable


def test_mcp_url():
    assert three_ws_mcp_url("https://example.test/") == "https://example.test/api/mcp-studio"


async def test_mcp_plugin_loads_studio_tools_and_calls_one():
    k = Kernel()
    async with create_three_ws_mcp_plugin(base_url=BASE) as studio:
        k.add_plugin(studio)
        names = set(k.get_plugin("threews_studio").functions)
        assert {"forge_free", "search_catalog", "check_job", "rig_mesh"} <= names
        result = await k.invoke(
            plugin_name="threews_studio",
            function_name="search_catalog",
            arguments=KernelArguments(q="chair", kind="object", limit=2),
        )
    text = str(result)
    assert "chair" in text.lower()
    assert ".glb" in text
