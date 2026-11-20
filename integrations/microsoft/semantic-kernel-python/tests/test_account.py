"""Making a model on three.ws needs an account.

An anonymous ``POST /api/forge`` answers 401 ``sign_in_required``, and the
studio MCP server refuses ``forge_free`` and ``rig_mesh`` without a verified
key. The client used to send no key on generation, so every run would fail once
the gate is live. These tests capture what the client actually puts on the wire
through httpx's transport hook, with no network.
"""

from __future__ import annotations

import httpx
import pytest

from threews_semantic_kernel import ThreeWsClient, ThreeWsError, create_three_ws_mcp_plugin

KEY = "sk_live_test_key"
SIGN_IN = {
    "error": "sign_in_required",
    "message": "Sign in to generate a 3D model. A three.ws account is free.",
    "sign_in_url": "/login",
    "api_keys_url": "/dashboard/api-keys",
}


def recording(handler):
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return httpx.AsyncClient(transport=httpx.MockTransport(record)), seen


async def test_generation_sends_the_api_key():
    http, seen = recording(lambda r: httpx.Response(200, json={"job_id": "j1", "status": "queued"}))
    async with ThreeWsClient("https://three.ws", api_key=KEY, http_client=http) as c:
        await c.submit_generation("a small wooden chair", tier="draft")
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"
    await http.aclose()


async def test_job_polls_send_the_api_key():
    http, seen = recording(lambda r: httpx.Response(200, json={"status": "running"}))
    async with ThreeWsClient("https://three.ws", api_key=KEY, http_client=http) as c:
        await c.get_job("j1")
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"
    await http.aclose()


async def test_generation_without_a_key_stops_before_the_network():
    http, seen = recording(lambda r: httpx.Response(200, json={}))
    async with ThreeWsClient("https://three.ws", http_client=http) as c:
        with pytest.raises(ThreeWsError) as info:
            await c.submit_generation("a small wooden chair")
    assert info.value.code == "needs_key"
    assert "https://three.ws/dashboard/api-keys" in info.value.message
    assert seen == []
    await http.aclose()


async def test_a_refused_key_says_how_to_fix_it():
    http, _ = recording(lambda r: httpx.Response(401, json=SIGN_IN))
    async with ThreeWsClient("https://three.ws", api_key="sk_live_revoked", http_client=http) as c:
        with pytest.raises(ThreeWsError) as info:
            await c.submit_generation("a small wooden chair")
    assert info.value.status == 401
    assert info.value.code == "needs_key"
    assert "Sign in to generate a 3D model" in info.value.message
    await http.aclose()


def test_mcp_plugin_sends_the_api_key(monkeypatch):
    monkeypatch.delenv("THREE_WS_API_KEY", raising=False)
    plugin = create_three_ws_mcp_plugin(api_key=KEY)
    assert plugin.headers == {"Authorization": f"Bearer {KEY}"}


def test_mcp_plugin_reads_the_key_from_the_environment(monkeypatch):
    monkeypatch.setenv("THREE_WS_API_KEY", KEY)
    assert create_three_ws_mcp_plugin().headers == {"Authorization": f"Bearer {KEY}"}
    monkeypatch.delenv("THREE_WS_API_KEY")
    assert not create_three_ws_mcp_plugin().headers

