"""The safe fetchers send a descriptive User-Agent unless the caller sets one.

upload.wikimedia.org answers httpx's default "python-httpx/<version>" agent
with 403 Forbidden, so every job whose reference photo was a Wikimedia link
failed before inference (model-triposg, 2026-10-09). Run: pytest -q
"""

import asyncio

import httpx
import pytest

import worker_security as ws


class _Recorder:
    def __init__(self):
        self.headers = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.headers.append(request.headers)
        return httpx.Response(200, content=b"image-bytes")


@pytest.fixture
def recorder(monkeypatch):
    rec = _Recorder()
    transport = httpx.MockTransport(rec.handler)
    real_client, real_async = httpx.Client, httpx.AsyncClient
    monkeypatch.setattr(ws, "_resolve_safe_host", lambda host: None)
    monkeypatch.setattr(ws.httpx, "Client", lambda **kw: real_client(transport=transport, **kw))
    monkeypatch.setattr(ws.httpx, "AsyncClient", lambda **kw: real_async(transport=transport, **kw))
    return rec


def test_sync_fetch_sends_the_default_user_agent(recorder):
    assert ws.fetch_remote_bytes("https://upload.example.org/a.jpg") == b"image-bytes"
    assert recorder.headers[0]["user-agent"] == ws.DEFAULT_USER_AGENT


def test_async_fetch_sends_the_default_user_agent(recorder):
    async def run():
        async with httpx.AsyncClient(follow_redirects=False) as client:
            return await ws.fetch_remote_bytes_async(client, "https://upload.example.org/a.jpg")

    body = asyncio.run(run())
    assert body == b"image-bytes"
    assert recorder.headers[0]["user-agent"] == ws.DEFAULT_USER_AGENT


def test_a_caller_user_agent_replaces_the_default_whatever_its_case(recorder):
    ws.fetch_remote_bytes("https://upload.example.org/a.jpg", headers={"user-agent": "custom/2"})
    assert recorder.headers[0].get_list("user-agent") == ["custom/2"]
