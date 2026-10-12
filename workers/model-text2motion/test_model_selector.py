"""Tests for main.py's model selector: resolution, task wiring, and routing.

No torch, no GPU, no checkpoint: `_load_model` is monkeypatched to install a
fake sampler object rather than importing mdm_sampler/momask_sampler, so this
exercises exactly what this worker owns: request validation, which backend a
job actually runs against, and the per-backend GCS path. Not either model's
real inference (covered by test_mdm_decode.py's pure-NumPy decode tests; real
on-GPU sampling is covered by server/index.mjs-level integration in the
platform's own `scripts/gcp/seed-motion.mjs` runs against the deployed lane).

Run (from this directory):
    python3 -m unittest discover -p 'test_*.py'
"""

from __future__ import annotations

import asyncio
import os
import unittest

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

import main  # noqa: E402  (env vars must be set first)
from fastapi.testclient import TestClient  # noqa: E402

AUTH = {"authorization": "Bearer test-key"}


class FakeSampler:
    """Stands in for MdmSampler/MomaskSampler: same `sample()` contract,
    zero GPU/torch/checkpoint dependency."""

    def __init__(self, name: str):
        self.name = name

    def sample(self, prompt: str, n_frames: int):
        import numpy as np

        poses = np.zeros((n_frames, 22, 3), dtype=np.float64)
        trans = np.zeros((n_frames, 3), dtype=np.float64)
        return poses, trans


class RecordingBlob:
    """Stands in for a storage.Blob so /infer's upload step can be exercised
    without a GCS project (same pattern as model-hunyuan3d's test suite)."""

    def __init__(self, store: dict, name: str):
        self._store = store
        self._name = name

    def upload_from_string(self, data, content_type=None):
        self._store[self._name] = data


class RecordingBucket:
    def __init__(self):
        self.objects: dict[str, str] = {}

    def blob(self, name: str) -> RecordingBlob:
        return RecordingBlob(self.objects, name)


class CanonicalModelTest(unittest.TestCase):
    def test_defaults_when_absent(self):
        self.assertEqual(main.canonical_model(None), "mdm")
        self.assertEqual(main.canonical_model(""), "mdm")

    def test_recognizes_momask(self):
        self.assertEqual(main.canonical_model("momask"), "momask")

    def test_case_insensitive(self):
        self.assertEqual(main.canonical_model("MoMask"), "momask")
        self.assertEqual(main.canonical_model(" MDM "), "mdm")

    def test_unknown_name_falls_back_to_default(self):
        # A stale/misspelled model name still has an obviously right thing to
        # do, same rationale as workers/rembg's canonical_model.
        self.assertEqual(main.canonical_model("t2m-gpt"), "mdm")


class ModelSelectorWiringTest(unittest.TestCase):
    """Exercises /infer, /tasks/:id, /health, / with fake samplers and a
    recording GCS bucket installed in place of the real GPU + storage
    backends. Built without the TestClient `with` block (that would run the
    real `lifespan`, which opens a real `storage.Client()` bucket handle and
    would overwrite the recording one set up below), same convention as
    model-hunyuan3d's test_worker_api.py."""

    def setUp(self):
        main._tasks.clear()
        main._models.clear()
        main._load_errors.clear()
        main._sem = asyncio.Semaphore(main.MAX_CONCURRENT)
        main._bucket = RecordingBucket()
        self._real_load_model = main._load_model

        def fake_load_model(name: str) -> None:
            main._models[name] = FakeSampler(name)

        main._load_model = fake_load_model
        self.addCleanup(lambda: setattr(main, "_load_model", self._real_load_model))
        self.client = TestClient(main.app)

    def test_infer_defaults_to_mdm_and_resolves_to_done(self):
        resp = self.client.post(
            "/infer",
            json={"prompt": "a person waves hello", "duration_seconds": 1, "fps": 10},
            headers=AUTH,
        )
        self.assertEqual(resp.status_code, 202)
        task_id = resp.json()["task_id"]

        task = self.client.get(f"/tasks/{task_id}", headers=AUTH).json()
        self.assertEqual(task["status"], "done")
        self.assertEqual(task["model"], "mdm")
        self.assertIn("motion-clips/mdm/", task["result_url"])
        self.assertEqual(task["frames"], 10)

    def test_infer_with_momask_routes_to_the_momask_backend(self):
        resp = self.client.post(
            "/infer",
            json={"prompt": "a slow tai-chi sweep", "duration_seconds": 1, "fps": 10, "model": "momask"},
            headers=AUTH,
        )
        self.assertEqual(resp.status_code, 202)
        task_id = resp.json()["task_id"]

        task = self.client.get(f"/tasks/{task_id}", headers=AUTH).json()
        self.assertEqual(task["status"], "done")
        self.assertEqual(task["model"], "momask")
        self.assertIn("motion-clips/momask/", task["result_url"])

    def test_unknown_model_name_falls_back_and_still_completes(self):
        resp = self.client.post(
            "/infer",
            json={"prompt": "a person jogs forward", "duration_seconds": 1, "fps": 10, "model": "nonexistent"},
            headers=AUTH,
        )
        task_id = resp.json()["task_id"]
        task = self.client.get(f"/tasks/{task_id}", headers=AUTH).json()
        self.assertEqual(task["model"], "mdm")
        self.assertEqual(task["status"], "done")

    def test_health_reports_default_loaded_and_both_backends_available(self):
        main._models["mdm"] = FakeSampler("mdm")  # normally warmed by the startup background task
        health = self.client.get("/health").json()
        self.assertTrue(health["ok"])
        self.assertTrue(health["model_loaded"])
        self.assertIn("mdm", health["models_loaded"])
        self.assertEqual(set(health["models_available"]), {"mdm", "momask"})
        self.assertEqual(health["default_model"], "mdm")

    def test_health_reflects_momask_once_it_has_been_requested(self):
        self.client.post(
            "/infer",
            json={"prompt": "a person kicks a ball", "duration_seconds": 1, "fps": 10, "model": "momask"},
            headers=AUTH,
        )
        health = self.client.get("/health").json()
        self.assertIn("momask", health["models_loaded"])

    def test_root_advertises_both_backends(self):
        root = self.client.get("/").json()
        self.assertEqual(root["model"], "mdm")
        self.assertEqual(set(root["models_available"]), {"mdm", "momask"})

    def test_missing_api_key_is_a_validation_error(self):
        resp = self.client.post("/infer", json={"prompt": "a person waves hello"})
        self.assertEqual(resp.status_code, 422)

    def test_wrong_api_key_is_rejected(self):
        resp = self.client.post(
            "/infer",
            json={"prompt": "a person waves hello"},
            headers={"authorization": "Bearer nope"},
        )
        self.assertEqual(resp.status_code, 401)


if __name__ == "__main__":
    unittest.main()
