"""Tests for the Publish to three.ws Modly process extension.

Spawns ``processor.py`` exactly the way Modly's PythonProcessRunner does (one
JSON line on stdin, JSON lines back on stdout) against an in-process stub of
the avatar upload + create endpoints. No Modly install, no live network. Run:
    ( cd integrations/modly/three-ws-publish && python -m unittest test_processor )
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
GLB = b"glTF" + (2).to_bytes(4, "little") + (16).to_bytes(4, "little") + b"JSON"


class _Account(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        st = self.server.state
        raw = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.headers.get("authorization") != "Bearer sk_live_good":
            return self._send(401, {"error": "unauthorized", "message": "sign in or provide a valid bearer token"})
        p = urllib.parse.urlparse(self.path)
        if p.path == "/api/avatars/upload":
            st["uploaded"] = raw
            return self._send(200, {"storage_key": "u/1/k.glb", "size_bytes": len(raw), "checksum_sha256": "a" * 64})
        if p.path == "/api/avatars":
            st["create"] = json.loads(raw)
            return self._send(201, {"avatar": {"id": "av_9"}})
        return self._send(404, {"error": "nf"})


class ProcessorTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _Account)
        self.server.state = {}
        self.host = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = Path(tempfile.mkdtemp())
        self.mesh = self.tmp / "workspace" / "Default" / "1700000000_ab12cd34.glb"
        self.mesh.parent.mkdir(parents=True)
        self.mesh.write_bytes(GLB)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _run(self, message, extra_env=None):
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(self.tmp / "home"),
            "XDG_CONFIG_HOME": str(self.tmp / "config"),
            "APPDATA": str(self.tmp / "config"),
            "THREE_WS_BASE_URL": self.host,
        }
        env.update(extra_env or {})
        proc = subprocess.run(
            [sys.executable, os.path.join(_HERE, "processor.py")],
            input=json.dumps(message) + "\n",
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
        return proc.returncode, lines

    def _message(self, **params):
        return {
            "input": {"filePath": "Default/1700000000_ab12cd34.glb"},
            "params": params,
            "workspaceDir": str(self.tmp / "workspace"),
            "tempDir": str(self.tmp),
        }

    def test_publishes_and_passes_mesh_through(self):
        code, lines = self._run(self._message(name="Brass Owl", visibility="unlisted", tags="modly, owl", api_key="sk_live_good"))
        self.assertEqual(code, 0, lines)
        done = lines[-1]
        self.assertEqual(done["type"], "done")
        self.assertEqual(done["result"]["filePath"], str(self.mesh))
        self.assertEqual(done["result"]["text"], f"{self.host}/avatars/av_9")
        self.assertEqual(self.server.state["uploaded"], GLB)
        create = self.server.state["create"]
        self.assertEqual(create["name"], "Brass Owl")
        self.assertEqual(create["visibility"], "unlisted")
        self.assertEqual(create["tags"], ["modly", "owl"])
        self.assertEqual(create["source_meta"]["generator"], "modly")
        self.assertTrue(any(l["type"] == "progress" for l in lines))

    def test_typed_key_is_saved_for_later_runs(self):
        self._run(self._message(api_key="sk_live_good"))
        saved = (self.tmp / "config" / "three-ws" / "modly-api-key").read_text()
        self.assertEqual(saved, "sk_live_good")
        code, lines = self._run(self._message())
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["type"], "done")

    def test_env_key(self):
        code, lines = self._run(self._message(), {"THREE_WS_API_KEY": "sk_live_good"})
        self.assertEqual(code, 0, lines)

    def test_missing_key_is_actionable(self):
        code, lines = self._run(self._message())
        self.assertEqual(code, 1)
        self.assertEqual(lines[-1]["type"], "error")
        self.assertIn("dashboard/api", lines[-1]["message"])

    def test_bad_key_hints_scope(self):
        code, lines = self._run(self._message(api_key="sk_live_bad"))
        self.assertEqual(code, 1)
        self.assertIn("avatars:write", lines[-1]["message"])

    def test_non_glb_input_is_explained(self):
        stl = self.mesh.with_suffix(".stl")
        stl.write_bytes(b"solid x")
        msg = self._message(api_key="sk_live_good")
        msg["input"]["filePath"] = str(stl)
        code, lines = self._run(msg)
        self.assertEqual(code, 1)
        self.assertIn("before any export", lines[-1]["message"])

    def test_missing_input(self):
        msg = self._message(api_key="sk_live_good")
        msg["input"] = {}
        code, lines = self._run(msg)
        self.assertEqual(code, 1)
        self.assertIn("Connect a mesh node", lines[-1]["message"])


if __name__ == "__main__":
    unittest.main()
