"""A local HTTP server that speaks the three.ws capture contract (C4).

Test double for the real API: it enforces the bearer key, hands out part URLs on
itself, checks the part list on ``complete`` and walks a job through the worker's
stages as it is polled. Used by the pytest client tests and the headless Blender
test, which both need the endpoints before a deployment has them.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = "test-key"
STAGES = ["download", "stitch", "frames", "sfm", "train", "export", "upload"]


class C4Server:
    def __init__(self, *, part_size=1024 * 1024, results=None, polls_to_finish=len(STAGES), put_delay=0.0,
                 slow_poll_at=None, slow_poll_s=0.0):
        self.part_size = part_size
        self.results = results or {}
        self.polls_to_finish = polls_to_finish
        self.put_delay = put_delay
        # The real API finalises a capture inside the poll that first sees the worker
        # finish (it copies the results into the bucket), so that one poll is slow.
        self.slow_poll_at = slow_poll_at
        self.slow_poll_s = slow_poll_s
        self.fail_puts = 0
        self.expire_first_put_with_403 = False
        self.uploads = {}
        self.files = {}
        self.jobs = {}
        self.log = []
        self.put_log = []
        self.lock = threading.Lock()
        self._counter = 0
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.port = self.httpd.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def next_id(self, prefix):
        with self.lock:
            self._counter += 1
            return f"{prefix}{self._counter:020d}"

    def _handler(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _send(self, code, payload=None, raw=None, headers=None):
                body = raw if raw is not None else json.dumps(payload or {}).encode()
                self.send_response(code)
                self.send_header("content-type", "application/octet-stream" if raw is not None else "application/json")
                self.send_header("content-length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def _authed(self):
                if self.headers.get("authorization") != f"Bearer {API_KEY}":
                    self._send(401, {"error": "sign_in_required", "message": "Sign in to continue."})
                    return False
                return True

            def _body(self):
                n = int(self.headers.get("content-length") or 0)
                return self.rfile.read(n) if n else b""

            def do_GET(self):
                url = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(url.query)
                server.log.append(("GET", self.path))
                if url.path.startswith("/_files/"):
                    data = server.files.get(url.path[len("/_files/"):])
                    return self._send(200, raw=data) if data is not None else self._send(404, {"error": "not_found"})
                if not self._authed():
                    return
                if url.path == "/api/pano-capture" and "mine" in q:
                    items = [
                        {"job_id": j["id"], "status": server._status(j), "created_at": "2026-11-21T12:00:00Z",
                         "poster_url": "", "viewer_url": f"/splat?src={j['id']}", "source_kind": j["source_kind"]}
                        for j in reversed(list(server.jobs.values())) if j["api"] == "capture"
                    ]
                    return self._send(200, {"captures": items})
                if url.path in ("/api/pano-capture", "/api/pano-scene") and "job" in q:
                    job = server.jobs.get(q["job"][0])
                    if not job:
                        return self._send(404, {"error": "not_found", "message": "No such job."})
                    if server.slow_poll_at is not None and job["polls"] == server.slow_poll_at:
                        body = server._job_body(job)
                        time.sleep(server.slow_poll_s)
                        return self._send(200, body)
                    return self._send(200, server._job_body(job))
                self._send(404, {"error": "not_found"})

            def do_PUT(self):
                url = urllib.parse.urlparse(self.path)
                data = self._body()
                parts = url.path.strip("/").split("/")
                if parts[0] != "_r2":
                    return self._send(404, {})
                upload_id, number = parts[1], int(parts[2])
                server.put_log.append((upload_id, number))
                if server.put_delay:
                    time.sleep(server.put_delay)
                with server.lock:
                    if server.expire_first_put_with_403:
                        server.expire_first_put_with_403 = False
                        return self._send(403, {"error": "expired"})
                    if server.fail_puts > 0:
                        server.fail_puts -= 1
                        return self._send(503, {"error": "busy"})
                    upload = server.uploads.get(upload_id)
                    if not upload:
                        return self._send(404, {"error": "no_such_upload"})
                    upload["parts"][number] = data
                etag = '"' + hashlib.md5(data).hexdigest() + '"'
                self._send(200, {}, headers={"ETag": etag})

            def do_DELETE(self):
                url = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(url.query)
                server.log.append(("DELETE", self.path))
                if not self._authed():
                    return
                job = server.jobs.get(q.get("job", [""])[0])
                if not job:
                    return self._send(404, {"error": "not_found"})
                job["cancelled"] = True
                self._send(200, {"status": "cancelled"})

            def do_POST(self):
                url = urllib.parse.urlparse(self.path)
                server.log.append(("POST", self.path))
                if not self._authed():
                    return
                body = json.loads(self._body() or b"{}")
                p = url.path
                if p == "/api/capture-upload/create":
                    size = body["size_bytes"]
                    upload_id = server.next_id("up")
                    key = f"captures/{upload_id}/{body['filename']}"
                    count = max(1, -(-size // server.part_size))
                    server.uploads[upload_id] = {"key": key, "parts": {}, "size": size, "filename": body["filename"],
                                                 "content_type": body["content_type"], "kind": body["kind"]}
                    return self._send(200, {"upload_id": upload_id, "key": key, "part_size": server.part_size, "part_count": count})
                if p == "/api/capture-upload/sign":
                    if body["upload_id"] not in server.uploads:
                        return self._send(404, {"error": "upload_not_found", "message": "Unknown upload."})
                    if len(body["part_numbers"]) > 100:
                        return self._send(400, {"error": "too_many_parts"})
                    return self._send(200, {"urls": {str(n): f"{server.url}/_r2/{body['upload_id']}/{n}" for n in body["part_numbers"]}})
                if p == "/api/capture-upload/complete":
                    upload = server.uploads.get(body["upload_id"])
                    if not upload:
                        return self._send(404, {"error": "upload_not_found", "message": "Unknown upload."})
                    data = b""
                    for entry in body["parts"]:
                        chunk = upload["parts"].get(entry["part_number"])
                        if chunk is None or entry["etag"] != '"' + hashlib.md5(chunk).hexdigest() + '"':
                            return self._send(400, {"error": "bad_parts", "message": "A part is missing or its ETag is wrong."})
                        data += chunk
                    if len(data) != upload["size"]:
                        return self._send(400, {"error": "size_mismatch", "message": "Size mismatch."})
                    server.files[upload["key"]] = data
                    return self._send(200, {"source_url": f"{server.url}/_files/{upload['key']}", "size_bytes": len(data)})
                if p == "/api/capture-upload/abort":
                    server.uploads.pop(body["upload_id"], None)
                    return self._send(200, {"ok": True})
                if p in ("/api/pano-capture", "/api/pano-scene"):
                    api = "capture" if p == "/api/pano-capture" else "scene"
                    job_id = server.next_id("job")
                    server.jobs[job_id] = {"id": job_id, "api": api, "polls": 0, "body": body,
                                           "source_kind": body.get("source_kind", ""), "cancelled": False}
                    return self._send(202, {"job_id": job_id, "status": "queued", "eta_seconds": 60})
                self._send(404, {"error": "not_found"})

        return Handler

    def _status(self, job):
        if job["cancelled"]:
            return "cancelled"
        return "succeeded" if job["polls"] >= self.polls_to_finish else ("queued" if job["polls"] == 0 else "running")

    def _job_body(self, job):
        job["polls"] += 1
        status = self._status(job)
        body = {"job_id": job["id"], "status": status}
        if status == "running":
            index = min(len(STAGES) - 1, int((job["polls"] / max(1, self.polls_to_finish)) * len(STAGES)))
            body["stage"] = STAGES[index]
            body["progress"] = round(job["polls"] / max(1, self.polls_to_finish), 3)
        if status == "succeeded":
            body["progress"] = 1.0
            body["result"] = {k: f"{self.url}/_files/{v}" if not v.startswith("http") else v for k, v in self.results.get(job["api"], {}).items()}
            body["result"]["viewer_url"] = f"/splat?src={job['id']}"
        return body
