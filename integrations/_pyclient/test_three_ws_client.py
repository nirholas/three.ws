"""Tests for the shared three.ws Forge client.

Runs a real in-process HTTP server that mimics the Forge contract — no live
network — so the submit/upload/poll/download paths and error handling are all
exercised end to end. Run with:  ``python -m pytest integrations/_pyclient``
or directly:  ``python integrations/_pyclient/test_three_ws_client.py``.
"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

from three_ws_client import ThreeWSClient, ThreeWSError, content_type_for_path, is_glb, slugify


def _glb(payload: bytes = b"JSON") -> bytes:
    """A header-valid GLB: magic, version 2, and a length equal to the buffer."""
    total = 12 + len(payload)
    return b"glTF" + (2).to_bytes(4, "little") + total.to_bytes(4, "little") + payload


class _Handler(BaseHTTPRequestHandler):
    """A minimal Forge stand-in. ``server.state`` drives behaviour per test."""

    def log_message(self, *args):  # silence test output
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            return {}

    def do_GET(self):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path == "/api/forge" and "catalog" in qs:
            return self._send(200, {"tiers": [{"id": "standard"}], "backends": []})
        if parsed.path == "/api/forge" and "job" in qs:
            state["poll_count"] += 1
            # Record the client handle so the test can assert scoping.
            state["last_client_handle"] = self.headers.get("x-forge-client")
            if state.get("fail_poll"):
                return self._send(200, {"job_id": qs["job"][0], "status": "failed", "error": "render exploded"})
            if state["poll_count"] >= state["done_after"]:
                return self._send(200, {"job_id": qs["job"][0], "status": "done", "glb_url": state["glb_url"]})
            return self._send(200, {"job_id": qs["job"][0], "status": "running"})
        if parsed.path == state["glb_path"]:
            data = b"glTF-binary-bytes"
            self.send_response(200)
            self.send_header("content-type", "model/gltf-binary")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        body = self._read_body()
        if parsed.path == "/api/forge-upload":
            host = f"http://127.0.0.1:{self.server.server_address[1]}"
            return self._send(200, {
                "storage_key": "forge/uploads/x/y.png",
                "upload_url": f"{host}/_put/y.png",
                "public_url": "https://cdn.example/forge/uploads/x/y.png",
                "method": "PUT",
                "headers": {"content-type": body.get("content_type", "image/png")},
                "expires_in": 300,
            })
        if parsed.path == "/api/forge":
            state["last_submit"] = body
            state["last_provider_key"] = self.headers.get("x-forge-provider-key")
            forced = state.get("submit_error")
            if forced:
                return self._send(200, forced)
            return self._send(200, {"job_id": "job_123", "status": "queued", "backend": "trellis"})
        return self._send(404, {"error": "not_found"})

    def do_PUT(self):
        # Accept the presigned image upload.
        length = int(self.headers.get("content-length", 0))
        self.rfile.read(length)
        self.server.state["uploaded_bytes"] = length
        self.send_response(200)
        self.send_header("content-length", "0")
        self.end_headers()


class ForgeClientTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _Handler)
        self.server.state = {
            "poll_count": 0,
            "done_after": 2,
            "glb_path": "/_glb/model.glb",
            "glb_url": None,
            "submit_error": None,
            "uploaded_bytes": 0,
        }
        port = self.server.server_address[1]
        self.server.state["glb_url"] = f"http://127.0.0.1:{port}{self.server.state['glb_path']}"
        self.base = f"http://127.0.0.1:{port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        # Fast polling for tests.
        self.client = ThreeWSClient(self.base, client_handle="test-handle")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_catalog(self):
        cat = self.client.get_catalog()
        self.assertIn("tiers", cat)

    def test_text_to_3d_end_to_end(self):
        glb = self.client.generate_text_to_3d(
            "a brass steampunk owl", tier="high", backend="trellis", poll_timeout=10
        )
        self.assertEqual(glb, self.server.state["glb_url"])
        # The submit body carried the right fields.
        self.assertEqual(self.server.state["last_submit"]["prompt"], "a brass steampunk owl")
        self.assertEqual(self.server.state["last_submit"]["tier"], "high")
        # Polling re-sent the anonymous client handle for scoping.
        self.assertEqual(self.server.state["last_client_handle"], "test-handle")
        self.assertGreaterEqual(self.server.state["poll_count"], 2)

    def test_image_to_3d_uploads_then_submits(self):
        glb = self.client.generate_image_to_3d(b"\x89PNG fake bytes", "image/png", poll_timeout=10)
        self.assertEqual(glb, self.server.state["glb_url"])
        self.assertGreater(self.server.state["uploaded_bytes"], 0)
        self.assertEqual(self.server.state["last_submit"]["image_urls"], ["https://cdn.example/forge/uploads/x/y.png"])

    def test_provider_key_header(self):
        client = ThreeWSClient(self.base, provider_key="secret-key", client_handle="h")
        client.submit_text_to_3d("a red ceramic teapot", backend="tripo")
        self.assertEqual(self.server.state["last_provider_key"], "secret-key")

    def test_needs_key_error(self):
        self.server.state["submit_error"] = {"error": "needs_key"}
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.submit_text_to_3d("a model", backend="meshy")
        self.assertEqual(ctx.exception.code, "needs_key")

    def test_failed_job_raises_at_poll(self):
        # Submit succeeds (job queued); the failure surfaces during polling.
        self.server.state["fail_poll"] = True
        job = self.client.submit_text_to_3d("a model that will fail")
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.poll(job["job_id"], interval=0.01, timeout=5)
        self.assertEqual(ctx.exception.code, "failed")
        self.assertIn("render exploded", ctx.exception.message)

    def test_short_prompt_rejected(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.submit_text_to_3d("hi")
        self.assertEqual(ctx.exception.code, "invalid_prompt")

    def test_download(self):
        import tempfile, os
        dest = os.path.join(tempfile.mkdtemp(), "out.glb")
        path = self.client.download(self.server.state["glb_url"], dest)
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), b"glTF-binary-bytes")

    def test_content_type_for_path(self):
        self.assertEqual(content_type_for_path("/a/b.PNG"), "image/png")
        self.assertEqual(content_type_for_path("photo.jpeg"), "image/jpeg")
        with self.assertRaises(ThreeWSError):
            content_type_for_path("model.gif")

    def test_poll_timeout(self):
        self.server.state["done_after"] = 9999
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.poll("job_123", interval=0.01, timeout=0.05)
        self.assertEqual(ctx.exception.code, "timeout")


class _AccountHandler(BaseHTTPRequestHandler):
    """Stands in for the authenticated avatar upload + create endpoints."""

    def log_message(self, *args):
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b""
        state["auth"].append(self.headers.get("authorization"))
        if self.headers.get("authorization") != "Bearer sk_live_test":
            return self._send(401, {"error": "unauthorized", "message": "sign in or provide a valid bearer token"})
        if parsed.path == "/api/avatars/upload":
            state["upload_query"] = urllib.parse.parse_qs(parsed.query)
            state["upload_content_type"] = self.headers.get("content-type")
            state["uploaded"] = raw
            return self._send(200, {
                "storage_key": "u/1/my-robot/abc.glb",
                "size_bytes": len(raw),
                "content_type": "model/gltf-binary",
                "checksum_sha256": "f" * 64,
            })
        if parsed.path == "/api/avatars":
            state["create"] = json.loads(raw.decode("utf-8"))
            return self._send(201, {"avatar": {"id": "av_1", "name": state["create"]["name"], "visibility": "unlisted"}})
        return self._send(404, {"error": "not_found"})


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _AccountHandler)
        self.server.state = {"auth": []}
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = ThreeWSClient(self.base, client_handle="h")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_publish_uploads_then_creates(self):
        glb = _glb()
        avatar = self.client.publish_glb(
            glb,
            api_key="sk_live_test",
            name="My Robot!",
            visibility="unlisted",
            tags=["modly", " ", "robot"],
            source_meta={"generator": "modly", "model": "triposg/generate"},
        )
        st = self.server.state
        self.assertEqual(avatar["id"], "av_1")
        self.assertEqual(st["uploaded"], glb)
        self.assertEqual(st["upload_content_type"], "model/gltf-binary")
        self.assertEqual(st["upload_query"]["slug"], ["my-robot"])
        self.assertEqual(st["create"]["storage_key"], "u/1/my-robot/abc.glb")
        self.assertEqual(st["create"]["size_bytes"], len(glb))
        self.assertEqual(st["create"]["tags"], ["modly", "robot"])
        self.assertEqual(st["create"]["source_meta"]["generator"], "modly")
        self.assertEqual(st["auth"], ["Bearer sk_live_test", "Bearer sk_live_test"])
        self.assertEqual(self.client.avatar_page_url(avatar), f"{self.base}/avatars/av_1")

    def test_publish_rejects_non_glb_before_any_request(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.publish_glb(b"not a glb at all", api_key="sk_live_test", name="x")
        self.assertEqual(ctx.exception.code, "invalid_glb")
        self.assertEqual(self.server.state["auth"], [])

    def test_publish_requires_key(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.publish_glb(_glb(), api_key="  ", name="x")
        self.assertEqual(ctx.exception.code, "missing_api_key")

    def test_publish_surfaces_auth_failure(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.publish_glb(_glb(), api_key="sk_live_wrong", name="x")
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(ctx.exception.code, "unauthorized")

    def test_helpers(self):
        self.assertTrue(is_glb(_glb()))
        self.assertFalse(is_glb(_glb()[:-1]))
        self.assertFalse(is_glb(b"glTF"))
        self.assertEqual(slugify("  Hello, World / v2 "), "hello-world-v2")
        self.assertEqual(slugify("!!!"), "model")
        self.assertLessEqual(len(slugify("a" * 200)), 64)


class _MeshOpsHandler(BaseHTTPRequestHandler):
    """Stands in for the GLB presign, the rigger, and the remesh worker."""

    def log_message(self, *args):
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            return {}

    def do_POST(self):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        body = self._read_body()
        host = f"http://127.0.0.1:{self.server.server_address[1]}"
        if parsed.path == "/api/scene-glb-upload":
            state["presign_body"] = body
            return self._send(200, {
                "upload_url": f"{host}/_put/scene.glb",
                "public_url": "https://cdn.example/scenes/scene.glb",
                "headers": {"content-type": "model/gltf-binary"},
                "method": "PUT",
                "expires_in": 900,
            })
        if parsed.path == "/api/forge" and qs.get("action") == ["rig"]:
            state["rig_body"] = body
            if state.get("rig_unconfigured"):
                return self._send(501, {"error": "rig_unconfigured", "message": "Rigging is not configured."})
            return self._send(202, {"job_id": "rig_1", "status": "queued"})
        if parsed.path == "/api/forge-remesh":
            state["remesh_body"] = body
            return self._send(202, {"job_id": "rm_1", "status": "queued"})
        return self._send(404, {"error": "not_found"})

    def do_GET(self):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/forge" and qs.get("job") == ["rig_1"]:
            state["rig_polls"] = state.get("rig_polls", 0) + 1
            if state["rig_polls"] < 2:
                return self._send(200, {"status": "running"})
            return self._send(200, {"status": "done", "glb_url": "https://cdn.example/rigged.glb"})
        if parsed.path == "/api/forge-remesh" and qs.get("job") == ["rm_1"]:
            state["remesh_polls"] = state.get("remesh_polls", 0) + 1
            if state["remesh_polls"] == 1:
                # The worker cold-starting answers 502 with no status: retry.
                return self._send(502, {"error": "upstream_unavailable"})
            if state.get("remesh_fail"):
                return self._send(200, {"status": "failed", "error": "mesh is not manifold"})
            return self._send(200, {
                "status": "done",
                "result_url": "https://cdn.example/remeshed.glb",
                "face_count": 4000,
            })
        return self._send(404, {"error": "not_found"})

    def do_PUT(self):
        length = int(self.headers.get("content-length", 0))
        self.server.state["put_bytes"] = self.rfile.read(length)
        self.server.state["put_type"] = self.headers.get("content-type")
        self.send_response(200)
        self.send_header("content-length", "0")
        self.end_headers()


class MeshOpsTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _MeshOpsHandler)
        self.server.state = {}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = ThreeWSClient(f"http://127.0.0.1:{self.server.server_address[1]}")
        self.no_sleep = {"_sleep": lambda _s: None}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_upload_glb_presigns_then_puts(self):
        glb = _glb(b"mesh-bytes")
        url = self.client.upload_glb(glb)
        self.assertEqual(url, "https://cdn.example/scenes/scene.glb")
        self.assertEqual(self.server.state["presign_body"], {"content_type": "model/gltf-binary", "size_bytes": len(glb)})
        self.assertEqual(self.server.state["put_bytes"], glb)
        self.assertEqual(self.server.state["put_type"], "model/gltf-binary")

    def test_upload_glb_rejects_non_glb_without_a_request(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.upload_glb(b"\x89PNG not a mesh")
        self.assertEqual(ctx.exception.code, "invalid_glb")
        self.assertNotIn("presign_body", self.server.state)

    def test_rig_submits_and_polls_for_glb_url(self):
        statuses = []
        url = self.client.rig(
            "https://cdn.example/static.glb",
            on_progress=lambda st, _e: statuses.append(st),
            **self.no_sleep,
        )
        self.assertEqual(url, "https://cdn.example/rigged.glb")
        self.assertEqual(self.server.state["rig_body"], {"glb_url": "https://cdn.example/static.glb"})
        self.assertEqual(statuses, ["running", "done"])

    def test_rig_unconfigured_surfaces_the_server_message(self):
        self.server.state["rig_unconfigured"] = True
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.rig("https://cdn.example/static.glb", **self.no_sleep)
        self.assertEqual(ctx.exception.code, "rig_unconfigured")
        self.assertEqual(ctx.exception.status, 501)

    def test_rig_requires_https_url(self):
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.submit_rig("file:///tmp/a.glb")
        self.assertEqual(ctx.exception.code, "invalid_glb_url")

    def test_remesh_retries_a_502_poll_and_returns_result_url(self):
        url = self.client.remesh(
            "https://cdn.example/raw.glb",
            remesh_mode="quad",
            operation="full",
            target_faces=4000,
            texture_size=2048,
            **self.no_sleep,
        )
        self.assertEqual(url, "https://cdn.example/remeshed.glb")
        self.assertEqual(self.server.state["remesh_polls"], 2)
        self.assertEqual(self.server.state["remesh_body"], {
            "mesh_url": "https://cdn.example/raw.glb",
            "remesh_mode": "quad",
            "operation": "full",
            "texture_size": 2048,
            "output_format": "glb",
            "target_faces": 4000,
        })

    def test_remesh_failure_raises(self):
        self.server.state["remesh_fail"] = True
        with self.assertRaises(ThreeWSError) as ctx:
            self.client.remesh("https://cdn.example/raw.glb", **self.no_sleep)
        self.assertIn("manifold", ctx.exception.message)

    def test_remesh_validates_options_before_any_request(self):
        for kwargs in ({"remesh_mode": "voxel"}, {"operation": "melt"}, {"texture_size": 300}):
            with self.assertRaises(ThreeWSError):
                self.client.submit_remesh("https://cdn.example/raw.glb", **kwargs)
        self.assertNotIn("remesh_body", self.server.state)


if __name__ == "__main__":
    unittest.main()
