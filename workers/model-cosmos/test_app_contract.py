import os
import time

os.environ.setdefault("API_KEY", "test-key")
os.environ["MODEL_LOAD_ATTEMPTS"] = "1"
os.environ["MODEL_DIR"] = "/nonexistent/cosmos3-nano"
os.environ.pop("TASK_BUCKET", None)

import pytest
from fastapi.testclient import TestClient

import control
import main

AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "LOCAL_TASK_DIR", tmp_path)
    with TestClient(main.app) as c:
        deadline = time.time() + 10
        while main._load_error is None and time.time() < deadline:
            time.sleep(0.05)
        yield c


def test_missing_checkpoint_reports_down(client):
    res = client.get("/health")
    assert res.status_code == 503
    body = res.json()
    assert body["ok"] is False and body["guardrail"] is False
    assert body["modes"] == ["text", "image", "depth", "edge"]
    assert "internal error" in body["load_error"]


def test_infer_refused_while_model_is_down(client):
    res = client.post("/infer", json={"prompt": "a lighthouse"}, headers=AUTH)
    assert res.status_code == 503


def test_auth_required(client):
    assert client.get("/tasks/abc").status_code == 401
    assert client.get("/tasks/abc", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_unknown_task_404(client):
    assert client.get("/tasks/deadbeef", headers=AUTH).status_code == 404
    assert client.get("/tasks/deadbeef/video", headers=AUTH).status_code == 404
    assert client.get("/tasks/..%2Fetc/video", headers=AUTH).status_code == 404


def test_orphaned_record_becomes_worker_restarted(client, tmp_path):
    main._write_record({"task_id": "abc123", "status": "generating", "updated_at": time.time() - 3600})
    body = client.get("/tasks/abc123", headers=AUTH).json()
    assert body["status"] == "failed" and body["error_code"] == "worker_restarted"


def test_is_orphaned():
    now = time.time()
    assert main.is_orphaned({"status": "queued"}, now)
    assert not main.is_orphaned({"status": "done", "updated_at": 0}, now)
    assert not main.is_orphaned({"status": "generating", "updated_at": now - 5}, now)


def test_classify_failure():
    assert main.classify_failure(control.ControlError("no edges"))[0] == "bad_control_video"
    assert main.classify_failure(RuntimeError("CUDA out of memory. Tried"))[0] == "gpu_oom"
    code, message = main.classify_failure(RuntimeError("boom /secret/path"))
    assert code == "generation_failed" and "/secret" not in message
