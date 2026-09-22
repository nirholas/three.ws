"""three_ws: call three.ws tools from inside a sandboxed script.

Every call goes over the local bridge socket ($THREE_WS_SOCKET) to the agent
runtime, which applies the same rules as a tool call made by the model: only
tools the run may use, the policy tiers, and no fund-moving tool from inside a
script (those need a preview and the user's confirmation in the conversation).

    import three_ws
    price = three_ws.tool("token_price", {"id": "solana"})
    r = three_ws.fetch("https://api.coingecko.com/api/v3/ping")
    print(r.status, r.json())
"""

import base64
import itertools
import json as _json
import os
import socket

__all__ = ["tool", "tools", "fetch", "fetch_json", "BridgeError", "Response"]

_ids = itertools.count(1)


class BridgeError(Exception):
    """A bridge refusal or failure. `code` is machine-readable, `detail` has the rest."""

    def __init__(self, code, message, detail=None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.detail = detail or {}


def _call(payload):
    path = os.environ.get("THREE_WS_SOCKET")
    if not path:
        raise BridgeError("no_bridge", "THREE_WS_SOCKET is not set: this is not running inside a three.ws sandbox")
    payload = dict(payload, id=next(_ids))
    data = (_json.dumps(payload) + "\n").encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.connect(path)
        s.sendall(data)
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    if not buf:
        raise BridgeError("bridge_closed", "the bridge closed the connection without answering")
    msg = _json.loads(buf.decode("utf-8"))
    if not msg.get("ok"):
        err = msg.get("error") or {}
        raise BridgeError(err.get("code", "bridge_error"), err.get("message", "bridge call failed"), err)
    return msg.get("result")


def tool(name, args=None):
    """Call a tool the run is allowed to use and return its result."""
    return _call({"op": "tool", "name": name, "args": args or {}})


def tools():
    """The tools this run may call: [{name, description, tier}]."""
    return _call({"op": "tools"})


class Response:
    def __init__(self, raw):
        self.status = raw.get("status")
        self.headers = raw.get("headers") or {}
        self.url = raw.get("url")
        self.content = base64.b64decode(raw.get("body_base64") or "")

    @property
    def ok(self):
        return isinstance(self.status, int) and 200 <= self.status < 300

    @property
    def text(self):
        return self.content.decode("utf-8", errors="replace")

    def json(self):
        return _json.loads(self.text)

    def raise_for_status(self):
        if not self.ok:
            raise BridgeError("http_error", f"{self.url} answered {self.status}", {"status": self.status})
        return self


def fetch(url, method="GET", headers=None, body=None, json=None):
    """HTTP through the bridge. Only hosts on the run's allowlist are reachable."""
    if json is not None:
        body = _json.dumps(json)
        headers = dict(headers or {}, **{"content-type": "application/json"})
    if isinstance(body, bytes):
        body_b64 = base64.b64encode(body).decode("ascii")
    elif body is not None:
        body_b64 = base64.b64encode(str(body).encode("utf-8")).decode("ascii")
    else:
        body_b64 = None
    raw = _call({"op": "fetch", "url": url, "method": method, "headers": headers or {}, "body_base64": body_b64})
    return Response(raw)


def fetch_json(url, **kwargs):
    """fetch() that raises on a non-2xx status and returns the parsed JSON body."""
    return fetch(url, **kwargs).raise_for_status().json()
