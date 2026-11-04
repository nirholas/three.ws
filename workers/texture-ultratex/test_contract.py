"""Contract and license-gate tests. Run: API_KEY=k python -m unittest test_contract (needs fastapi)."""

import os
import unittest

os.environ.setdefault("API_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import contract  # noqa: E402
import main  # noqa: E402

AUTH = {"Authorization": "Bearer test-key"}
BODY = {"mesh": "https://example.com/a.glb", "prompt": "weathered bronze statue"}


class GateTests(unittest.TestCase):
    def test_closed_by_default(self):
        self.assertFalse(contract.license_gate({})["open"])

    def test_only_exact_value_opens(self):
        self.assertFalse(contract.license_gate({contract.LICENSE_ACK_ENV: "1"})["open"])
        self.assertTrue(contract.license_gate({contract.LICENSE_ACK_ENV: contract.LICENSE_ACK_VALUE})["open"])


class RouteTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop(contract.LICENSE_ACK_ENV, None)
        self.client = TestClient(main.app)

    def test_health_is_public_and_reports_gate(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertFalse(data["license_gate_open"])
        self.assertEqual(data["service"], "texture-ultratex")

    def test_texture_requires_bearer(self):
        self.assertEqual(self.client.post("/texture", json=BODY, headers={"Authorization": "Bearer nope"}).status_code, 401)

    def test_texture_refused_while_gate_closed(self):
        r = self.client.post("/texture", json=BODY, headers=AUTH)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"]["error"], "license_gate_closed")

    def test_validation_matches_texture_worker(self):
        for bad in ({"prompt": "x"}, {**BODY, "prompt": "ab"}, {**BODY, "num_views": 3}, {**BODY, "texture_size": 4096}, {**BODY, "material_class": "mud"}):
            self.assertEqual(self.client.post("/texture", json=bad, headers=AUTH).status_code, 422, bad)

    def test_unknown_task_404(self):
        self.assertEqual(self.client.get("/tasks/missing", headers=AUTH).status_code, 404)

    def test_gate_open_returns_202_task_shape(self):
        os.environ[contract.LICENSE_ACK_ENV] = contract.LICENSE_ACK_VALUE
        try:
            async def noop(task_id, body):
                return None
            original = main._process
            main._process = noop
            try:
                r = self.client.post("/texture", json=BODY, headers=AUTH)
            finally:
                main._process = original
            self.assertEqual(r.status_code, 202)
            data = r.json()
            self.assertEqual(set(data), {"task_id", "status"})
            self.assertEqual(data["status"], "queued")
            got = self.client.get(f"/tasks/{data['task_id']}", headers=AUTH).json()
            self.assertEqual(got["prompt"], BODY["prompt"])
        finally:
            os.environ.pop(contract.LICENSE_ACK_ENV, None)


if __name__ == "__main__":
    unittest.main()
