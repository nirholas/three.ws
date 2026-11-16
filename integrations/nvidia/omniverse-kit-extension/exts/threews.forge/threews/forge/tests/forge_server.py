"""A local HTTP server that speaks the Forge contract, for the offline tests.

It exists to make the failure paths deterministic (a 503 on submit, a dropped
connection mid-poll, a 402 on the High lane), which a production server cannot
be asked to produce on demand. The happy path is also proven against the real
three.ws API in ``test_live.py``.

Every request is recorded with its headers so tests can assert where the API
key was, and was not, sent.
"""

from __future__ import annotations

import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List

from .glb_fixture import box_glb

GOOD_KEY = "sk_test_offline_fixture_key_0001"
BROKE_KEY = "sk_test_offline_fixture_key_0002"


class ForgeStandIn:
    def __init__(self):
        self.requests: List[dict] = []
        self.fail_submit = 0          # answer the next N submits with 503
        self.busy_submit = 0          # answer the next N submits with a rate_limited body
        self.drop_polls = 0           # close the socket on the next N polls
        self.fail_download = 0        # answer the next N downloads with 502
        self.polls_until_done = 2
        self.job_status = "done"      # or "failed"
        self.cache_hit = False
        self.long_job_ids = False     # issue signed job tokens longer than a file name may be, like production
        self.storage_down = False     # answer upload presigns with 503 storage_unavailable
        self.uploads: Dict[str, bytes] = {}
        self.glb = box_glb()
        self.models = [
            {"id": f"m{i:02d}", "name": f"Saved model {i}", "size_bytes": len(self.glb), "visibility": "private",
             "created_at": "2026-11-16T00:00:00Z", "thumbnail_url": "", "usdz_url": "", "model_url": ""}
            for i in range(5)
        ]
        self._polls: Dict[str, int] = {}
        self._jobs = 0
        self._lock = threading.Lock()
        stand_in = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def _json(self, status: int, payload: dict) -> None:
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _record(self, body=None):
                with stand_in._lock:
                    stand_in.requests.append(
                        {"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}
                    )

            def do_POST(self):
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                self._record(body)
                if self.path == "/api/forge-upload":
                    if stand_in.storage_down:
                        return self._json(503, {"error": "storage_unavailable", "message": "Image storage is not configured."})
                    name = f"ref{len(stand_in.uploads) + 1}"
                    return self._json(
                        200,
                        {
                            "upload_url": stand_in.url(f"/put/{name}"),
                            "public_url": stand_in.url(f"/refs/{name}"),
                            "headers": {"content-type": body.get("content_type") or "image/png"},
                        },
                    )
                if self.path != "/api/forge":
                    return self._json(404, {"error": "not_found"})
                if stand_in.busy_submit > 0:
                    stand_in.busy_submit -= 1
                    return self._json(200, {"error": "rate_limited", "queued": False, "message": "The 3D generator is busy right now.", "retry_after": 0.1})
                if stand_in.fail_submit > 0:
                    stand_in.fail_submit -= 1
                    return self._json(503, {"error": "upstream_unavailable", "message": "GPU pool restarting"})
                if body.get("tier") == "high":
                    key = self._bearer()
                    if key not in (GOOD_KEY, BROKE_KEY):
                        return self._json(401, {"error": "invalid_api_key", "message": "Invalid API key."})
                    if key == BROKE_KEY:
                        return self._json(402, {"error": "insufficient_credits", "message": "Balance $0.00 is below the $0.40 High price."})
                if stand_in.cache_hit:
                    return self._json(200, {"status": "done", "cached": True, "glb_url": stand_in.url("/files/box.glb")})
                with stand_in._lock:
                    stand_in._jobs += 1
                    job = f"job{stand_in._jobs}"
                    if stand_in.long_job_ids:
                        job = f"f1.{job}." + "eyJwIjoiZ2NwIiwiayI6bnVsbH0" * 12
                return self._json(202, {"job_id": job, "status": "queued", "backend": "fixture", "eta_seconds": 20})

            def do_PUT(self):
                length = int(self.headers.get("content-length") or 0)
                data = self.rfile.read(length)
                self._record({"bytes": len(data)})
                if not self.path.startswith("/put/"):
                    return self._json(404, {"error": "not_found"})
                with stand_in._lock:
                    stand_in.uploads[self.path[len("/put/"):]] = data
                self.send_response(200)
                self.send_header("content-length", "0")
                self.end_headers()

            def _bearer(self) -> str:
                auth = self.headers.get("authorization") or ""
                return auth[7:] if auth.lower().startswith("bearer ") else ""

            def do_GET(self):
                self._record()
                parsed = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(parsed.query)
                if parsed.path == "/api/forge" and "job" in query:
                    return self._poll(query["job"][0])
                if parsed.path == "/files/box.glb":
                    return self._file()
                if parsed.path == "/api/credits":
                    key = self._bearer()
                    if key not in (GOOD_KEY, BROKE_KEY):
                        return self._json(401, {"error": "invalid_api_key", "message": "Invalid API key."})
                    balance = 12.5 if key == GOOD_KEY else 0.0
                    return self._json(
                        200,
                        {
                            "balance_usd": balance,
                            "holder": {"discount_bps": 0, "tier": {"label": "Standard"}},
                            "buys": [{"id": "forge.high", "usd": 0.4}],
                        },
                    )
                if parsed.path == "/api/avatars":
                    if self._bearer() not in (GOOD_KEY, BROKE_KEY):
                        return self._json(401, {"error": "invalid_api_key"})
                    limit = int(query.get("limit", ["24"])[0])
                    start = int(query.get("cursor", ["0"])[0] or 0)
                    page = stand_in.models[start : start + limit]
                    nxt = str(start + limit) if start + limit < len(stand_in.models) else ""
                    return self._json(200, {"avatars": page, "next_cursor": nxt})
                if parsed.path.startswith("/api/avatars/") and parsed.path.endswith("/glb"):
                    if self._bearer() not in (GOOD_KEY, BROKE_KEY):
                        return self._json(401, {"error": "invalid_api_key"})
                    return self._file()
                return self._json(404, {"error": "not_found"})

            def _poll(self, job: str):
                if stand_in.drop_polls > 0:
                    stand_in.drop_polls -= 1
                    self.close_connection = True
                    self.connection.shutdown(2)
                    return
                with stand_in._lock:
                    n = stand_in._polls.get(job, 0) + 1
                    stand_in._polls[job] = n
                if n < stand_in.polls_until_done:
                    remaining = max(0, 20 - 10 * n)
                    return self._json(200, {"status": "running", "eta_seconds": 20, "eta_remaining_seconds": remaining, "backend": "fixture"})
                if stand_in.job_status == "failed":
                    return self._json(200, {"status": "failed", "error": "The GPU worker ran out of memory."})
                return self._json(200, {"status": "done", "glb_url": stand_in.url("/files/box.glb"), "backend": "fixture"})

            def _file(self):
                if stand_in.fail_download > 0:
                    stand_in.fail_download -= 1
                    return self._json(502, {"error": "bad_gateway"})
                self.send_response(200)
                self.send_header("content-type", "model/gltf-binary")
                self.send_header("content-length", str(len(stand_in.glb)))
                self.end_headers()
                self.wfile.write(stand_in.glb)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def url(self, path: str) -> str:
        return self.base_url + path

    def start(self) -> "ForgeStandIn":
        self._thread.start()
        return self

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def requests_to(self, path_prefix: str) -> List[dict]:
        return [r for r in self.requests if r["path"].startswith(path_prefix)]
