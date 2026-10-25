import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

TOKEN = "test-launch-token-0123456789abcdef"
HOST = {"Host": "127.0.0.1:8765"}


class SidecarAccessControlTests(unittest.TestCase):
    """The loopback sidecar must not be drivable by arbitrary web pages."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._env = mock.patch.dict(os.environ, {"FORGE_API_TOKEN": TOKEN, "FORGE_ALLOWED_ORIGINS": "null"})
        cls._env.start()
        from fastapi import FastAPI
        import access_control
        from routers import settings
        app = FastAPI()
        access_control.install_access_control(app)
        app.include_router(settings.router)
        access_control.register_workspace_route(app)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._env.stop()

    def test_request_without_token_is_rejected(self) -> None:
        r = self.client.get("/settings/paths", headers=HOST)
        self.assertEqual(r.status_code, 401)

    def test_request_with_wrong_token_is_rejected(self) -> None:
        r = self.client.get("/settings/paths", headers={**HOST, "X-Forge-Token": "nope"})
        self.assertEqual(r.status_code, 401)

    def test_request_with_token_is_served(self) -> None:
        r = self.client.get("/settings/paths", headers={**HOST, "X-Forge-Token": TOKEN})
        self.assertEqual(r.status_code, 200)

    def test_foreign_host_header_is_rejected_even_with_token(self) -> None:
        r = self.client.get("/settings/paths", headers={"Host": "evil.example", "X-Forge-Token": TOKEN})
        self.assertEqual(r.status_code, 403)

    def test_cors_does_not_allow_arbitrary_origins(self) -> None:
        r = self.client.options(
            "/settings/hf-token",
            headers={**HOST, "Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "content-type,x-forge-token"},
        )
        self.assertNotEqual(r.headers.get("access-control-allow-origin"), "*")
        self.assertNotEqual(r.headers.get("access-control-allow-origin"), "https://evil.example")

    def test_workspace_file_outside_workspace_is_not_served(self) -> None:
        import services.generator_registry as reg
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ws").mkdir()
            (root / "secret.txt").write_text("secret")
            (root / "ws" / "ok.txt").write_text("fine")
            with mock.patch.object(reg, "WORKSPACE_DIR", root / "ws"):
                h = {**HOST, "X-Forge-Token": TOKEN}
                self.assertEqual(self.client.get("/workspace/ok.txt", headers=h).status_code, 200)
                self.assertEqual(self.client.get("/workspace/..%2Fsecret.txt", headers=h).status_code, 404)
                self.assertEqual(self.client.get("/workspace/%2e%2e/secret.txt", headers=h).status_code, 404)

    def test_workspace_symlink_escape_is_not_served(self) -> None:
        import services.generator_registry as reg
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ws").mkdir()
            (root / "secret.txt").write_text("secret")
            try:
                (root / "ws" / "link.txt").symlink_to(root / "secret.txt")
            except OSError:
                self.skipTest("symlinks unavailable")
            with mock.patch.object(reg, "WORKSPACE_DIR", root / "ws"):
                r = self.client.get("/workspace/link.txt", headers={**HOST, "X-Forge-Token": TOKEN})
                self.assertEqual(r.status_code, 404)

    def test_settings_paths_rejects_filesystem_root_as_workspace(self) -> None:
        import services.generator_registry as reg
        h = {**HOST, "X-Forge-Token": TOKEN}
        with mock.patch.object(reg.generator_registry, "update_paths") as upd:
            for bad in ("/", "C:\\", "relative/dir"):
                r = self.client.post("/settings/paths", json={"workspace_dir": bad}, headers=h)
                self.assertEqual(r.status_code, 400, bad)
            upd.assert_not_called()

    def test_three_ws_base_url_must_be_https_or_loopback(self) -> None:
        h = {**HOST, "X-Forge-Token": TOKEN}
        with mock.patch.dict(os.environ, {}, clear=False):
            r = self.client.post("/settings/three-ws", json={"api_key": "k", "base_url": "http://attacker.example"}, headers=h)
            self.assertEqual(r.status_code, 400)
            r = self.client.post("/settings/three-ws", json={"api_key": "k", "base_url": "https://three.ws"}, headers=h)
            self.assertEqual(r.status_code, 200)
            os.environ.pop("THREE_WS_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
