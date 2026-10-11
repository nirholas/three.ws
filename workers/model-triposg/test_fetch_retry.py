"""Unit tests for the transient-failure retry in worker_security.fetch_remote_bytes.
No network, no torch. Runs anywhere:

    python3 workers/model-triposg/test_fetch_retry.py

(also collectable by pytest if it is installed). worker_security.py is vendored
byte-identical into every worker, so these pin the behavior for all of them: a
dropped connection or a 5xx/429 is retried, while a refused URL, an oversize
body, or any other 4xx fails on the first attempt.
"""

from __future__ import annotations

import asyncio
import sys

import httpx

import worker_security as ws


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://img.example/a.png")
    return httpx.HTTPStatusError("x", request=request, response=httpx.Response(code, request=request))


def _run_sync(failures: list[BaseException]) -> tuple[object, int]:
    calls = {"n": 0}

    def fake_once(url, **_kwargs):
        calls["n"] += 1
        if failures:
            raise failures.pop(0)
        return b"png-bytes"

    original_once, original_sleep = ws._fetch_once, ws.time.sleep
    ws._fetch_once, ws.time.sleep = fake_once, lambda _s: None
    try:
        try:
            return ws.fetch_remote_bytes("https://img.example/a.png"), calls["n"]
        except Exception as exc:  # noqa: BLE001, the outcome under test
            return exc, calls["n"]
    finally:
        ws._fetch_once, ws.time.sleep = original_once, original_sleep


def _run_async(failures: list[BaseException]) -> tuple[object, int]:
    calls = {"n": 0}

    async def fake_once(client, url, **_kwargs):
        calls["n"] += 1
        if failures:
            raise failures.pop(0)
        return b"png-bytes"

    async def no_sleep(_s):
        return None

    original_once, original_sleep = ws._fetch_once_async, ws.asyncio.sleep
    ws._fetch_once_async, ws.asyncio.sleep = fake_once, no_sleep
    try:
        try:
            result = asyncio.run(ws.fetch_remote_bytes_async(None, "https://img.example/a.png"))
            return result, calls["n"]
        except Exception as exc:  # noqa: BLE001, the outcome under test
            return exc, calls["n"]
    finally:
        ws._fetch_once_async, ws.asyncio.sleep = original_once, original_sleep


def test_dropped_connection_is_retried_then_succeeds():
    drop = httpx.RemoteProtocolError("Server disconnected without sending a response.")
    for run in (_run_sync, _run_async):
        result, calls = run([drop, drop])
        assert result == b"png-bytes", result
        assert calls == 3


def test_server_errors_and_429_are_retried():
    for code in (429, 500, 503):
        for run in (_run_sync, _run_async):
            result, calls = run([_status_error(code)])
            assert result == b"png-bytes", (code, result)
            assert calls == 2


def test_gives_up_after_the_attempt_budget():
    drops = [httpx.ReadTimeout("slow")] * ws._FETCH_ATTEMPTS
    for run in (_run_sync, _run_async):
        result, calls = run(list(drops))
        assert isinstance(result, httpx.ReadTimeout), result
        assert calls == ws._FETCH_ATTEMPTS


def test_final_answers_are_not_retried():
    for failure in (_status_error(403), _status_error(404), ws.UnsafeUrlError("private"), ValueError("too large")):
        for run in (_run_sync, _run_async):
            result, calls = run([failure])
            assert result is failure, result
            assert calls == 1


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
    sys.exit(0)
