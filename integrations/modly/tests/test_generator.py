"""Tests for the three.ws Modly extension.

The generator is loaded the way Modly's direct mode loads it: by file path,
with the extension folder and Modly's ``services.generators.base`` importable.
``host/`` holds a copy of Modly's real ``BaseGenerator`` so the contract under
test is the one the extension plugs into. A real in-process HTTP server stands
in for three.ws Forge (no live network). Run with:

    python -m unittest discover -s integrations/modly/tests -p 'test_*.py'
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

_HERE = Path(__file__).resolve().parent
_EXT = _HERE.parent / "three-ws"
sys.path[:0] = [str(_HERE / "host"), str(_EXT)]

_spec = importlib.util.spec_from_file_location("extensions.three-ws.generator", _EXT / "generator.py")
generator_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generator_mod)

from services.generators.base import GenerationCancelled  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 300


def glb(payload: bytes = b"mesh") -> bytes:
    total = 12 + len(payload)
    return b"glTF" + (2).to_bytes(4, "little") + total.to_bytes(4, "little") + payload


class _Forge(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            return {"raw": raw}

    @property
    def host(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def do_GET(self):
        st = self.server.state
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query, keep_blank_values=True)
        if u.path == "/api/forge" and "catalog" in qs:
            st["catalog_hits"] = st.get("catalog_hits", 0) + 1
            return self._send(200, {"backends": [
                {"id": "hunyuan3d", "label": "Hunyuan3D", "paths": ["image"], "byok": None, "configured": True},
                {"id": "trellis", "label": "TRELLIS", "paths": ["image"], "byok": None, "configured": False},
                {"id": "meshy", "label": "Meshy 6", "paths": ["geometry", "image"], "byok": "meshy", "configured": True},
            ]})
        if u.path in ("/api/forge", "/api/forge-remesh") and "job" in qs:
            job = qs["job"][0]
            key = "result_url" if u.path.endswith("remesh") else "glb_url"
            if st.get("fail_job"):
                return self._send(200, {"status": "failed", "error": "lane exploded"})
            return self._send(200, {"status": "done", key: f"{self.host}/_glb/{job}.glb"})
        if u.path.startswith("/_glb/"):
            data = st["glbs"].get(u.path, glb(u.path.encode()))
            self.send_response(200)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        st = self.server.state
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        body = self._body()
        st.setdefault("posts", []).append((self.path, body, {k.lower(): v for k, v in self.headers.items()}))
        if u.path in ("/api/forge-upload", "/api/scene-glb-upload"):
            return self._send(200, {"upload_url": f"{self.host}/_put/x", "public_url": f"https://cdn.example{u.path}/x"})
        if u.path == "/api/forge" and qs.get("action") == ["rig"]:
            return self._send(202, {"job_id": "rig1"})
        if u.path == "/api/forge":
            return self._send(200, {"job_id": "gen1", "backend": body.get("backend") or "hunyuan3d"})
        if u.path == "/api/forge-remesh":
            return self._send(202, {"job_id": "rm1"})
        if u.path == "/api/avatars/upload":
            return self._send(200, {"storage_key": "u/k.glb", "size_bytes": 16})
        if u.path == "/api/avatars":
            return self._send(201, {"avatar": {"id": "av_1", "name": body.get("name")}})
        return self._send(404, {"error": "not_found"})

    def do_PUT(self):
        n = int(self.headers.get("content-length", 0))
        self.server.state.setdefault("puts", []).append(self.rfile.read(n))
        self.send_response(200)
        self.send_header("content-length", "0")
        self.end_headers()


class GeneratorTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _Forge)
        self.server.state = {"glbs": {}}
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.models = root / "models"
        self.workspace = root / "workspace"
        self.workspace.mkdir()
        self.env = mock.patch.dict(os.environ, {
            "THREE_WS_BASE_URL": f"http://127.0.0.1:{self.server.server_address[1]}",
            "WORKSPACE_DIR": str(self.workspace),
        })
        self.env.start()
        os.environ.pop("THREE_WS_PROVIDER_KEY", None)
        os.environ.pop("THREE_WS_API_KEY", None)
        self.events = []
        # The poll loop sleeps between ticks; a done-on-first-poll stub never sleeps.

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def node(self, node_id):
        """Instantiate exactly as the registry does in direct mode."""
        gen = generator_mod.ThreeWSGenerator(self.models / f"three-ws/{node_id}", self.workspace)
        gen.MODEL_ID = f"three-ws/{node_id}"
        gen.MODEL_NODE_ID = node_id
        gen.outputs_dir = self.workspace / "Default"
        return gen

    def run_node(self, node_id, data, params=None, cancel=None):
        gen = self.node(node_id)
        self.assertTrue(gen.is_downloaded())
        gen.load()
        out = gen.generate(data, params or {}, lambda p, s: self.events.append((p, s)), cancel or threading.Event())
        return gen, Path(out)

    def submits(self, path="/api/forge"):
        return [b for p, b, _h in self.server.state.get("posts", []) if p == path]

    def test_image_to_3d_writes_a_glb_into_the_collection(self):
        _gen, out = self.run_node("image-to-3d", PNG, {"engine": "hunyuan3d", "tier": "high"})
        self.assertEqual(out.parent, self.workspace / "Default")
        self.assertTrue(out.read_bytes().startswith(b"glTF"))
        self.assertEqual(self.submits()[0]["backend"], "hunyuan3d")
        self.assertEqual(self.submits()[0]["tier"], "high")
        self.assertEqual(self.submits()[0]["image_urls"], ["https://cdn.example/api/forge-upload/x"])
        pcts = [p for p, _s in self.events]
        self.assertEqual(pcts, sorted(pcts))

    def test_engine_not_live_falls_back_to_server_default_and_says_so(self):
        self.run_node("image-to-3d", PNG, {"engine": "trellis"})
        self.assertNotIn("backend", self.submits()[0])
        self.assertTrue(any("not available" in s for _p, s in self.events))

    def test_byok_engine_without_a_key_explains_how_to_fix_it(self):
        with self.assertRaises(ValueError) as ctx:
            self.run_node("image-to-3d", PNG, {"engine": "meshy"})
        self.assertIn("THREE_WS_PROVIDER_KEY", str(ctx.exception))
        self.assertEqual(self.submits(), [])

    def test_byok_key_travels_as_header(self):
        self.run_node("text-to-3d", b"", {"prompt": "a brass lantern", "route": "geometry", "engine": "meshy", "provider_key": "msy_test"})
        headers = [h for p, _b, h in self.server.state["posts"] if p == "/api/forge"][0]
        self.assertEqual(headers.get("x-forge-provider-key"), "msy_test")
        self.assertEqual(self.submits()[0]["path"], "geometry")

    def test_text_to_3d_reads_the_prompt_the_workflow_runner_injects(self):
        _gen, out = self.run_node("text-to-3d", PNG, {"prompt": "a red fox", "text": "a red fox"})
        self.assertEqual(self.submits()[0]["prompt"], "a red fox")
        self.assertTrue(out.is_file())

    def test_text_to_3d_requires_a_prompt(self):
        with self.assertRaises(ValueError):
            self.run_node("text-to-3d", PNG, {})

    def test_sketch_needs_a_real_drawing_and_a_prompt(self):
        tiny = b"\x89PNG\r\n\x1a\n" + b"\x00" * 60
        with self.assertRaises(ValueError):
            self.run_node("sketch-to-3d", tiny, {"prompt": "a chair"})
        with self.assertRaises(ValueError):
            self.run_node("sketch-to-3d", PNG, {})
        self.run_node("sketch-to-3d", PNG, {"prompt": "a chair with curved legs"})
        self.assertEqual(self.submits()[0]["path"], "sketch")

    def test_chaining_reuses_the_cloud_url_instead_of_reuploading(self):
        _gen, made = self.run_node("image-to-3d", PNG)
        uploads_before = len(self.submits("/api/scene-glb-upload"))
        # The workflow runner hands the upstream GLB to a mesh node as bytes.
        self.run_node("rig", made.read_bytes())
        self.assertEqual(len(self.submits("/api/scene-glb-upload")), uploads_before)
        rig_body = self.submits("/api/forge?action=rig")[0]
        self.assertTrue(rig_body["glb_url"].endswith("/_glb/gen1.glb"))

    def test_local_mesh_is_uploaded_once_then_remembered(self):
        local = self.workspace / "Default" / "local.glb"
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(glb(b"made-by-a-local-model"))
        params = {"mesh_path": "Default/local.glb", "remesh_mode": "quad", "target_faces": 4000, "texture_size": 2048}
        _gen, out = self.run_node("remesh", PNG, params)
        self.run_node("remesh", PNG, params)
        self.assertEqual(len(self.submits("/api/scene-glb-upload")), 1)
        body = self.submits("/api/forge-remesh")[0]
        self.assertEqual((body["remesh_mode"], body["target_faces"], body["texture_size"]), ("quad", 4000, 2048))
        self.assertIn("three-ws-remesh-quad", out.name)

    def test_mesh_path_accepts_the_generate_page_url_form(self):
        local = self.workspace / "Default" / "a.glb"
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(glb(b"a"))
        self.run_node("rig", PNG, {"mesh_path": "/workspace/Default/a.glb"})
        self.assertEqual(len(self.submits("/api/scene-glb-upload")), 1)

    def test_mesh_path_cannot_escape_the_workspace(self):
        with self.assertRaises(ValueError):
            self.run_node("rig", PNG, {"mesh_path": "../../etc/passwd"})

    def test_mesh_nodes_reject_non_glb_input(self):
        with self.assertRaises(ValueError):
            self.run_node("remesh", PNG)

    def test_failed_job_surfaces_the_server_error(self):
        self.server.state["fail_job"] = True
        with self.assertRaises(RuntimeError) as ctx:
            self.run_node("image-to-3d", PNG)
        self.assertIn("lane exploded", str(ctx.exception))

    def test_cancel_maps_to_modly_generation_cancelled(self):
        cancel = threading.Event()
        cancel.set()
        gen = self.node("rig")
        gen.load()
        with self.assertRaises(GenerationCancelled):
            gen.generate(glb(b"x"), {}, None, cancel)

    def test_publish_saves_to_the_account_and_passes_the_mesh_through(self):
        data = glb(b"publish-me")
        with mock.patch.object(generator_mod.webbrowser, "open") as opened:
            _gen, out = self.run_node("publish", data, {"api_key": "sk_live_x", "name": "Fox", "visibility": "public"})
        self.assertEqual(out.read_bytes(), data)
        opened.assert_called_once()
        self.assertTrue(opened.call_args[0][0].endswith("/avatars/av_1"))
        created = self.submits("/api/avatars")[0]
        self.assertEqual((created["name"], created["visibility"]), ("Fox", "public"))

    def test_publish_without_a_key_says_where_to_get_one(self):
        with self.assertRaises(RuntimeError) as ctx:
            self.run_node("publish", glb(b"x"))
        self.assertIn("dashboard/api", str(ctx.exception))

    def test_client_handle_is_stable_across_nodes(self):
        a = self.node("image-to-3d")
        a.load()
        b = self.node("rig")
        b.load()
        self.assertEqual(a._model.client_handle, b._model.client_handle)


class ManifestTest(unittest.TestCase):
    def test_manifest_matches_what_modly_requires(self):
        manifest = json.loads((_EXT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["id"], _EXT.name)
        self.assertEqual(manifest["type"], "model")
        self.assertTrue(hasattr(generator_mod, manifest["generator_class"]))
        handled = {"image-to-3d", "text-to-3d", "sketch-to-3d", "rig", "remesh", "publish"}
        self.assertEqual({n["id"] for n in manifest["nodes"]}, handled)
        for node in manifest["nodes"]:
            self.assertNotIn("hf_repo", node)
            for param in node["params_schema"]:
                self.assertIn(param["type"], {"select", "int", "float", "string"})
                if param["type"] == "select":
                    self.assertIn(param["default"], [o["value"] for o in param["options"]])

    def test_direct_mode_needs_no_setup(self):
        for name in ("setup.py", "build_vendor.py", "requirements.txt"):
            self.assertFalse((_EXT / name).exists(), name)


if __name__ == "__main__":
    unittest.main()
