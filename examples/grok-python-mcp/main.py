"""Grok finds or makes a 3D chair through the three.ws studio server.

Uses the official xAI Python SDK (xai-sdk) with the three.ws studio server as a
remote MCP tool. xAI connects to the server and runs the tool calls on its own
side; this script streams them as they happen and prints the final GLB URL.

    XAI_API_KEY=... THREE_WS_API_KEY=... python main.py
    python main.py --check     three.ws leg only: list tools, search the catalog (no xAI key)
    python main.py "a brass desk lamp"   any other request

Keys are read from the environment only and are never printed.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

MCP_URL = os.environ.get("THREE_WS_MCP_URL", "https://three.ws/api/mcp-studio")
MODEL = os.environ.get("XAI_MODEL", "grok-4.7")
ALLOWED_TOOLS = ["search_catalog", "forge_free", "check_job"]
DEFAULT_TASK = "find a chair in the free catalog, and if none fits, make a low-poly wooden chair"
MAX_ROUNDS = 8
WAIT_BETWEEN_ROUNDS_S = 20
GLB_URL = re.compile(r"https?://[^\s)\"'\]<>]+?\.glb(?:\?[^\s)\"'\]<>]*)?")

EXIT_OK, EXIT_FAILED, EXIT_NO_KEY = 0, 1, 2


def xai_key() -> str | None:
    return os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")


# The three.ws leg, spoken directly: MCP JSON-RPC over plain HTTP POST.
def mcp_call(method: str, params: dict, session_id: str | None = None) -> tuple[dict, str | None]:
    headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
    if session_id:
        headers["mcp-session-id"] = session_id
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = json.loads(res.read().decode())
            return payload, res.headers.get("mcp-session-id") or session_id
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"{MCP_URL} answered HTTP {err.code} to {method}: {err.read()[:300]!r}") from err


def check() -> int:
    init, session = mcp_call(
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "grok-python-mcp-example", "version": "1.0.0"}},
    )
    listed, session = mcp_call("tools/list", {}, session)
    names = [t["name"] for t in listed["result"]["tools"]]
    missing = [n for n in ALLOWED_TOOLS if n not in names]
    print(f"server   {init['result']['serverInfo']['name']} ({MCP_URL})")
    print(f"tools    {len(names)} offered; this example allows {', '.join(ALLOWED_TOOLS)}")
    if missing:
        print(f"error    the server does not offer: {', '.join(missing)}", file=sys.stderr)
        return EXIT_FAILED
    found, _ = mcp_call("tools/call", {"name": "search_catalog", "arguments": {"q": "chair", "kind": "object", "limit": 3}}, session)
    items = found["result"].get("structuredContent", {}).get("items", [])
    if not items:
        print("error    search_catalog returned no chairs", file=sys.stderr)
        return EXIT_FAILED
    for item in items:
        print(f"catalog  {item['title']}  {item['url']}")
    print("ok       three.ws leg is live")
    return EXIT_OK


def print_tool_calls(chunk) -> None:
    for call in chunk.tool_calls:
        args = call.function.arguments
        print(f"tool     {call.function.name} {args[:200]}", flush=True)


def run(task: str) -> int:
    key = xai_key()
    if not key:
        print("error    set XAI_API_KEY (create one at https://console.x.ai), or run with --check", file=sys.stderr)
        return EXIT_NO_KEY
    three_ws_key = os.environ.get("THREE_WS_API_KEY")
    if not three_ws_key:
        print(
            "note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key "
            "from https://three.ws/dashboard/api-keys",
            file=sys.stderr,
        )

    from xai_sdk import Client
    from xai_sdk.chat import user
    from xai_sdk.tools import mcp

    client = Client(api_key=key)
    chat = client.chat.create(
        model=MODEL,
        tools=[
            mcp(
                server_url=MCP_URL,
                server_label="three-ws",
                server_description="Free 3D studio: search CC0 3D assets, or make a textured GLB from one sentence.",
                allowed_tool_names=ALLOWED_TOOLS,
                authorization=three_ws_key,
            )
        ],
        include=["verbose_streaming"],
    )
    chat.append(
        user(
            f"Use three-ws to {task}. A generation can come back pending with a job_id: collect it with check_job. "
            "When you have the model, reply with one line per field: 'GLB: <url>' and 'Viewer: <url>'."
        )
    )

    for round_no in range(1, MAX_ROUNDS + 1):
        text = ""
        response = None
        for response, chunk in chat.stream():
            print_tool_calls(chunk)
            text += chunk.content or ""
        chat.append(response)
        match = GLB_URL.search(text)
        if match:
            print(f"\n{text.strip()}\n")
            print(f"glb      {match.group(0)}")
            return EXIT_OK
        print(f"round {round_no}: no GLB yet, asking Grok to collect the job again in {WAIT_BETWEEN_ROUNDS_S}s", flush=True)
        time.sleep(WAIT_BETWEEN_ROUNDS_S)
        chat.append(user("Call check_job on that job again. When it is done, reply with 'GLB: <url>' and 'Viewer: <url>'."))

    print(f"error    no GLB after {MAX_ROUNDS} rounds; the last reply was:\n{text}", file=sys.stderr)
    return EXIT_FAILED


def main(argv: list[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    words = [a for a in argv if not a.startswith("--")]
    try:
        if "--check" in flags:
            return check()
        return run(" ".join(words) or DEFAULT_TASK)
    except Exception as err:  # the network boundary: report, never a stack trace
        # xai-sdk speaks gRPC: its errors carry a status code and xAI's own message.
        code, details = getattr(err, "code", None), getattr(err, "details", None)
        if callable(code) and callable(details):
            print(f"error    xAI answered {code().name}: {details()}", file=sys.stderr)
        else:
            print(f"error    {type(err).__name__}: {err}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
