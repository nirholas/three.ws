"""Tests for the Poe bot: message parsing, the HTTP surface, and a full chat turn
against an in-process server that speaks the Forge contract."""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi.testclient import TestClient

import forge_bot


class _Forge(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        self.server.last_body = json.loads(self.rfile.read(length))
        self._send({"job_id": "job-1", "status": "queued", "backend": "trellis_selfhost"})

    def do_GET(self):
        self.server.polls += 1
        if self.server.polls < 2:
            return self._send({"status": "running"})
        self._send({"status": "done", "glb_url": "https://cdn.example/chair.glb", "preview_image_url": "https://cdn.example/chair.png"})


KEY = "k" * 32


def _query(text):
    return {
        "version": "1.0",
        "type": "query",
        "query": [{"role": "user", "content": text, "content_type": "text/markdown", "timestamp": 0, "message_id": "m1", "feedback": [], "attachments": []}],
        "user_id": "u1",
        "conversation_id": "c1",
        "message_id": "m2",
    }


class ParseTest(unittest.TestCase):
    def test_tier_defaults_to_draft(self):
        self.assertEqual(forge_bot.parse_request("a small wooden chair"), ("a small wooden chair", "draft"))

    def test_tier_is_extracted_and_removed(self):
        self.assertEqual(forge_bot.parse_request("a robot, tier: high"), ("a robot", "high"))

    def test_viewer_url_encodes(self):
        self.assertEqual(forge_bot.viewer_url("https://a/b.glb"), "https://three.ws/viewer?src=https%3A%2F%2Fa%2Fb.glb")


class ChatTurnTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _Forge)
        cls.server.polls = 0
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        forge_bot.POLL_INTERVAL = 0.01
        bot = forge_bot.ForgeBot(base_url=f"http://127.0.0.1:{cls.server.server_address[1]}")
        import fastapi_poe as fp

        cls.client = TestClient(fp.make_app(bot, access_key=KEY), headers={"Authorization": f"Bearer {KEY}"})

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_settings_declare_introduction_and_no_attachments(self):
        resp = self.client.post("/", json={"version": "1.0", "type": "settings"})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["allow_attachments"])
        self.assertIn("textured 3D model", resp.json()["introduction_message"])

    def test_chat_turn_streams_progress_then_links(self):
        resp = self.client.post("/", json=_query("a small wooden chair tier: standard"))
        self.assertEqual(resp.status_code, 200)
        text = resp.text
        self.assertIn("Forging", text)
        self.assertIn("viewer?src=", text)
        self.assertIn("https://cdn.example/chair.glb", text)
        self.assertIn("chair.png", text)
        self.assertEqual(self.server.last_body["tier"], "standard")
        self.assertEqual(self.server.last_body["prompt"], "a small wooden chair")

    def test_short_prompt_is_answered_without_calling_forge(self):
        before = getattr(self.server, "last_body", None)
        resp = self.client.post("/", json=_query("hi"))
        self.assertIn("at least 3 characters", resp.text)
        self.assertEqual(getattr(self.server, "last_body", None), before)


if __name__ == "__main__":
    unittest.main()
