"""Traffic-split rules and the GPU-lane submit contract (forwarder.py):

    python3 workers/rembg/test_forwarder.py

The transport is httpx.MockTransport, which runs the real client code path
(request building, auth header, JSON decoding) against scripted responses.
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx

from forwarder import ForwardError, forward_percent, forward_submit, should_forward

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


URL = "https://rembg-triton.example.run.app"
TASK = "0b9f0c8e-5d3c-4a8e-9b51-2f1c6d7e8a90"

check("unset percent is 0", forward_percent(None) == 0.0)
check("empty percent is 0", forward_percent("") == 0.0)
check("typo percent is 0, never 100", forward_percent("1o0") == 0.0)
check("NaN percent is 0", forward_percent("nan") == 0.0)
check("percent clamps high", forward_percent("250") == 100.0)
check("percent clamps low", forward_percent("-5") == 0.0)
check("fractional percent parses", forward_percent("12.5") == 12.5)

check("no URL never forwards", not should_forward(None, 100.0, 0.0))
check("0 percent never forwards", not should_forward(URL, 0.0, 0.0))
check("100 percent always forwards", should_forward(URL, 100.0, 0.999999))
check("10 percent forwards a low draw", should_forward(URL, 10.0, 0.05))
check("10 percent keeps a high draw local", not should_forward(URL, 10.0, 0.5))
share = sum(should_forward(URL, 25.0, i / 1000) for i in range(1000)) / 1000
check("the forwarded share matches the percent", abs(share - 0.25) < 1e-9, str(share))


def run(handler, body=None):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await forward_submit(client, URL + "/", "secret", body or {"image": "https://x/y.png"})
    return asyncio.run(go())


seen = {}


def accept(request: httpx.Request) -> httpx.Response:
    seen["url"] = str(request.url)
    seen["auth"] = request.headers.get("authorization")
    seen["body"] = json.loads(request.content)
    return httpx.Response(202, json={"task_id": TASK, "status": "queued", "model": "isnet-general-use"})


got = run(accept, {"image": "data:image/png;base64,AAAA", "model": "rmbg2"})
check("the submit goes to the lane's /remove", seen["url"] == URL + "/remove", seen["url"])
check("the shared bearer key is sent", seen["auth"] == "Bearer secret")
check("the caller's body is forwarded untouched",
      seen["body"] == {"image": "data:image/png;base64,AAAA", "model": "rmbg2"})
check("the lane's task id comes back", got["task_id"] == TASK and got["model"] == "isnet-general-use", str(got))


def expect_error(name, handler):
    try:
        run(handler)
        check(name, False, "no ForwardError")
    except ForwardError:
        check(name, True)


expect_error("a 503 from the lane falls back", lambda r: httpx.Response(503, text="no capacity"))
expect_error("a 401 from the lane falls back", lambda r: httpx.Response(401, json={"detail": "bad key"}))
expect_error("a non-JSON 202 falls back", lambda r: httpx.Response(202, text="<html>"))
expect_error("a 202 without a uuid falls back", lambda r: httpx.Response(202, json={"task_id": "../x"}))


def unreachable(request):
    raise httpx.ConnectError("connection refused", request=request)


expect_error("an unreachable lane falls back", unreachable)

print(f"\n{PASS} checks passed")
