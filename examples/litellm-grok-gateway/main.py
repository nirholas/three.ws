"""Grok with the three.ws 3D tools, through a LiteLLM proxy.

The proxy (config.yaml) routes the model alias `grok` to xAI and registers the
three.ws studio server in LiteLLM's MCP gateway. This script is an ordinary
OpenAI-compatible client of that proxy, standard library only:

    python main.py --check      gateway leg only: list the MCP tools, search the catalog (no xAI key)
    python main.py              (the proxy reads XAI_API_KEY, not this script) Grok finds a wooden chair through the proxy and prints the viewer link
    python main.py "a brass desk lamp"   any other request

Environment (never printed):
    LITELLM_MASTER_KEY  the key the proxy was started with, sent as the bearer (required)
    LITELLM_BASE_URL    default http://127.0.0.1:4317
    THREE_WS_API_KEY    optional, forwarded to three.ws as the x-mcp-three_ws-authorization header
    GROK_ALIAS          default grok (the model_name in config.yaml)
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://127.0.0.1:4317").rstrip("/")
ALIAS = os.environ.get("GROK_ALIAS", "grok")
SERVER = "three_ws"
DEFAULT_TASK = "find a wooden chair in the free catalog and give me its viewer link"
VIEWER_URL = re.compile(r"https://three\.ws/viewer\?[^\s)\"'\]<>`]+")

EXIT_OK, EXIT_FAILED, EXIT_NO_KEY = 0, 1, 2


class MissingKey(RuntimeError):
    pass


def proxy_key() -> str:
    key = os.environ.get("LITELLM_MASTER_KEY")
    if not key:
        raise MissingKey("LITELLM_MASTER_KEY is not set: export the key the proxy was started with")
    return key


def three_ws_headers() -> dict[str, str]:
    token = os.environ.get("THREE_WS_API_KEY")
    return {f"x-mcp-{SERVER}-authorization": f"Bearer {token}"} if token else {}


def post(path: str, body: dict, extra: dict[str, str] | None = None, timeout: int = 120):
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "authorization": f"Bearer {proxy_key()}",
        **(extra or {}),
    }
    req = urllib.request.Request(BASE_URL + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read().decode(), res.headers
    except urllib.error.HTTPError as err:
        raise ProxyError(err.code, err.read().decode(errors="replace")) from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"cannot reach the proxy at {BASE_URL} ({err.reason}); start it first, see README.md") from err


class ProxyError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:600]}")
        self.status, self.body = status, body


def sse_json(text: str) -> dict:
    """The gateway answers MCP over Streamable HTTP as one SSE event or plain JSON."""
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(text)


class Gateway:
    """MCP JSON-RPC against the proxy's /mcp endpoint (the LiteLLM MCP gateway)."""

    def __init__(self) -> None:
        self.session: str | None = None
        self.next_id = 0

    def rpc(self, method: str, params: dict | None = None, notify: bool = False) -> dict:
        msg: dict = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notify:
            self.next_id += 1
            msg["id"] = self.next_id
        extra = {"x-mcp-servers": SERVER, **three_ws_headers()}
        if self.session:
            extra["mcp-session-id"] = self.session
        text, headers = post("/mcp", msg, extra)
        self.session = headers.get("mcp-session-id") or self.session
        if notify:
            return {}
        reply = sse_json(text)
        if "error" in reply:
            raise RuntimeError(f"gateway error on {method}: {reply['error']}")
        return reply["result"]

    def open(self) -> dict:
        info = self.rpc(
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "litellm-grok-gateway-example", "version": "1.0.0"}},
        )
        self.rpc("notifications/initialized", notify=True)
        return info

    def tools(self) -> list[dict]:
        return self.rpc("tools/list")["tools"]

    def call(self, name: str, arguments: dict) -> str:
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        return "\n".join(c.get("text", "") for c in result.get("content", []))


def check() -> int:
    gw = Gateway()
    gw.open()
    tools = gw.tools()
    names = [t["name"] for t in tools]
    print(f"gateway  {BASE_URL}/mcp, server {SERVER}")
    print(f"tools    {len(names)} through the gateway: {', '.join(names)}")
    search = next((n for n in names if n.endswith("search_catalog")), None)
    if not search:
        hint = " (is THREE_WS_API_KEY valid? three.ws rejects a bad key before it lists tools)" if three_ws_headers() else ""
        print(f"error    search_catalog is not exposed by the gateway{hint}", file=sys.stderr)
        return EXIT_FAILED
    text = gw.call(search, {"q": "chair", "limit": 3})
    items = re.findall(r"^- `([^`]+)` \| ([^|]+) \|", text, re.M)
    glbs = re.findall(r"^\s+GLB: (\S+)", text, re.M)
    if not items:
        print(f"error    search_catalog returned no items: {text[:300]}", file=sys.stderr)
        return EXIT_FAILED
    for (item_id, title), glb in zip(items, glbs):
        print(f"catalog  {title.strip()}  {glb}")
    print("ok       gateway leg is live")
    return EXIT_OK


def ask_grok(task: str) -> int:
    body = {
        "model": ALIAS,
        "input": task,
        "tools": [
            {
                "type": "mcp",
                "server_label": SERVER,
                "server_url": f"litellm_proxy/mcp/{SERVER}",
                "require_approval": "never",
                "headers": three_ws_headers(),
            }
        ],
    }
    try:
        text, _ = post("/v1/responses", body, timeout=300)
    except ProxyError as err:
        print(f"error    the proxy answered {err}", file=sys.stderr)
        return EXIT_NO_KEY if "api key is required" in err.body.lower() else EXIT_FAILED
    response = json.loads(text)
    answer: list[str] = []
    for item in response.get("output", []):
        kind = item.get("type")
        if kind == "tool_execution_results":
            # The proxy runs the MCP calls itself and reports each result, not the arguments.
            for part in item.get("content", []):
                for run in json.loads(part.get("text", "[]")):
                    first = str(run.get("result", "")).splitlines()[0] if run.get("result") else ""
                    print(f"tool     {run.get('tool_call_id')}: {first}")
        elif kind == "message":
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    answer.append(part["text"])
    final = "\n".join(answer).strip()
    print(f"\n{final}\n")
    link = VIEWER_URL.search(final)
    if not link:
        print("error    the answer holds no three.ws viewer link", file=sys.stderr)
        return EXIT_FAILED
    print(f"viewer   {link.group(0)}")
    return EXIT_OK


def main(argv: list[str]) -> int:
    try:
        if "--check" in argv:
            return check()
        task = " ".join(a for a in argv if not a.startswith("--")) or DEFAULT_TASK
        return ask_grok(task)
    except MissingKey as err:
        print(f"error    {err}", file=sys.stderr)
        return EXIT_NO_KEY
    except RuntimeError as err:
        print(f"error    {err}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
