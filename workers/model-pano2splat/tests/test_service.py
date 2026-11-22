import json
import os
import signal
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

import main
import source_fetch
import stages
from fake_stages import write_fake_stages
from pipeline import PipelineError, PipelineRequest, run_pipeline
from results import GcsStore, LocalStore
from source_fetch import ByteBudget, SourceError, download_source
from stages import Cancelled, StageRunner

MP4 = b"\x00\x00\x00\x18ftypisom" + b"0" * 2000
JPEG = b"\xff\xd8\xff\xe0" + b"1" * 2000
AUTH = {"Authorization": "Bearer test-key"}


class Files(BaseHTTPRequestHandler):
    routes: dict = {}

    def do_GET(self):  # noqa: N802
        body = self.routes.get(self.path.split("?")[0])
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@pytest.fixture()
def http_files(monkeypatch):
    Files.routes = {"/v.mp4": MP4, "/a.jpg": JPEG, "/b.jpg": JPEG, "/raw.insv": MP4, "/page.html": b"<html>" + b"x" * 100}
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Files)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(source_fetch, "assert_safe_url", lambda url, **kw: url)
    monkeypatch.setattr(main, "assert_safe_url", lambda url, **kw: url)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture()
def fake_stages(tmp_path, monkeypatch):
    root = write_fake_stages(tmp_path / "stages")
    monkeypatch.setattr(stages, "STAGES_DIR", root)
    monkeypatch.setenv("FAKE_LOG", str(tmp_path / "calls.jsonl"))
    return root


def calls(tmp_path):
    p = tmp_path / "calls.jsonl"
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []


def wait_for(mgr, task_id, statuses=("succeeded", "failed", "cancelled"), timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = mgr.get(task_id)
        if body and body["status"] in statuses:
            return body
        time.sleep(0.05)
    raise AssertionError(f"task stuck: {mgr.get(task_id)}")


@pytest.fixture()
def mgr(tmp_path):
    m = main.TaskManager(LocalStore(tmp_path / "store"), work_dir=str(tmp_path))
    m.start()
    yield m
    m.stop()


def req(**kw):
    base = dict(task="splat", source_kind="equirect_video", source_url="http://x/v.mp4")
    base.update(kw)
    return main.InferRequest(**base)


# -- auth and request validation ----------------------------------------------


def test_auth_required(monkeypatch, tmp_path):
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    with TestClient(main.app) as client:
        body = {"task": "splat", "source_kind": "equirect_video", "source_url": "https://example.com/v.mp4"}
        assert client.post("/infer", json=body).status_code == 401
        assert client.post("/infer", json=body, headers={"Authorization": "Bearer nope"}).status_code == 401
        assert client.get("/tasks/" + "a" * 32).status_code == 401
        assert client.delete("/tasks/" + "a" * 32).status_code == 401
        err = client.post("/infer", json=body).json()
        assert err["error"] == "unauthorized" and err["message"]


@pytest.mark.parametrize(
    "url",
    ["http://example.com/v.mp4", "https://127.0.0.1/v.mp4", "https://169.254.169.254/latest", "https://10.0.0.5/v.mp4", "file:///etc/passwd"],
)
def test_ssrf_rejected_at_request_time(monkeypatch, tmp_path, url):
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    with TestClient(main.app) as client:
        r = client.post("/infer", headers=AUTH, json={"task": "splat", "source_kind": "equirect_video", "source_url": url})
        assert r.status_code == 400
        assert r.json()["error"] == "unsafe_source_url"


@pytest.mark.parametrize(
    "body,code",
    [
        ({"task": "splat", "source_kind": "insp", "source_url": "https://e.com/a.insp"}, "unsupported_input"),
        ({"task": "stitch", "source_kind": "equirect_video", "source_url": "https://e.com/a.mp4"}, "unsupported_input"),
        ({"task": "splat", "source_kind": "equirect_video"}, "invalid_request"),
        ({"task": "splat", "source_kind": "bogus", "source_url": "https://e.com/a.mp4"}, "invalid_request"),
        ({"task": "splat", "source_kind": "equirect_video", "source_url": "https://e.com/a.mp4", "trim": {"start_s": 9, "end_s": 3}}, "invalid_request"),
    ],
)
def test_invalid_requests(monkeypatch, tmp_path, body, code):
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    monkeypatch.setattr(main, "assert_safe_url", lambda url, **kw: url)
    with TestClient(main.app) as client:
        r = client.post("/infer", headers=AUTH, json=body)
        assert r.status_code == 400
        assert r.json()["error"] == code


def test_unknown_task_is_404_and_ids_are_validated(monkeypatch, tmp_path):
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    with TestClient(main.app) as client:
        assert client.get("/tasks/" + "a" * 32, headers=AUTH).status_code == 404
        assert client.get("/tasks/..%2F..%2Fetc", headers=AUTH).status_code == 404


# -- download: size cap and sniffing -------------------------------------------


def test_size_cap_enforced_while_streaming(http_files, tmp_path):
    with pytest.raises(SourceError) as exc:
        download_source(http_files + "/v.mp4", tmp_path / "f", "equirect_video", ByteBudget(500))
    assert exc.value.code == "source_too_large"
    assert not list(tmp_path.glob("f*"))


def test_size_cap_is_shared_across_files(http_files, tmp_path):
    budget = ByteBudget(len(JPEG) + 10)
    download_source(http_files + "/a.jpg", tmp_path / "1", "equirect_images", budget)
    with pytest.raises(SourceError) as exc:
        download_source(http_files + "/b.jpg", tmp_path / "2", "equirect_images", budget)
    assert exc.value.code == "source_too_large"


@pytest.mark.parametrize(
    "path,kind,ext",
    [("/v.mp4", "equirect_video", ".mp4"), ("/raw.insv", "insv", ".insv"), ("/a.jpg", "equirect_images", ".jpg"), ("/a.jpg", "insp", ".insp")],
)
def test_sniff_accepts_matching_content(http_files, tmp_path, path, kind, ext):
    out = download_source(http_files + path, tmp_path / "f", kind, ByteBudget())
    assert out.suffix == ext and out.exists()


@pytest.mark.parametrize("path,kind", [("/page.html", "equirect_video"), ("/a.jpg", "insv"), ("/v.mp4", "equirect_images")])
def test_sniff_rejects_wrong_content(http_files, tmp_path, path, kind):
    with pytest.raises(SourceError) as exc:
        download_source(http_files + path, tmp_path / "f", kind, ByteBudget())
    assert exc.value.code == "unsupported_input"
    assert not list(tmp_path.glob("f*"))


def test_missing_source_is_reported(http_files, tmp_path):
    with pytest.raises(SourceError) as exc:
        download_source(http_files + "/nope.mp4", tmp_path / "f", "equirect_video", ByteBudget())
    assert exc.value.code == "source_unreachable"


# -- orchestration --------------------------------------------------------------


def test_splat_from_equirect_video(http_files, fake_stages, mgr, tmp_path):
    tid = mgr.submit(req(source_url=http_files + "/v.mp4", quality="preview", trim=main.Trim(start_s=2, end_s=30)), [http_files + "/v.mp4"])
    body = wait_for(mgr, tid)
    assert body["status"] == "succeeded", body
    assert body["progress"] == 1.0
    result = body["result"]
    for field in ("ply_url", "spz_url", "preview_url", "poster_url"):
        assert result[field].startswith("file://")
    assert "equirect_url" not in result
    assert result["stats"]["train"]["iterations"] == 7000
    assert result["stats"]["sfm"]["registration_ratio"] == 0.95
    made = calls(tmp_path)
    assert [c["module"] for c in made] == ["pano_sfm", "splat_train"]
    sfm, train = made[0]["argv"], made[1]["argv"]
    assert sfm[sfm.index("--fps") + 1] == "1" and sfm[sfm.index("--max-frames") + 1] == "120"
    assert sfm[sfm.index("--trim-start") + 1] == "2.0" and sfm[sfm.index("--trim-end") + 1] == "30.0"
    assert "--mask-operator" in sfm
    assert train[train.index("--iterations") + 1] == "7000" and "--preview-video" in train
    assert train[train.index("--holdout-every") + 1] == "8"


def test_high_quality_preset(http_files, fake_stages, mgr, tmp_path):
    tid = mgr.submit(req(source_url=http_files + "/v.mp4", quality="high"), [http_files + "/v.mp4"])
    assert wait_for(mgr, tid)["status"] == "succeeded"
    sfm, train = (c["argv"] for c in calls(tmp_path))
    assert sfm[sfm.index("--fps") + 1] == "3" and sfm[sfm.index("--max-frames") + 1] == "600"
    assert train[train.index("--max-gaussians") + 1] == "6000000" and train[train.index("--iterations") + 1] == "30000"


def test_splat_from_insv_pair_stitches_first(http_files, fake_stages, mgr, tmp_path):
    urls = [http_files + "/raw.insv", http_files + "/raw.insv?part=2"]
    tid = mgr.submit(req(source_kind="insv", source_url=None, source_urls=urls, trim=main.Trim(start_s=1, end_s=9)), urls)
    body = wait_for(mgr, tid)
    assert body["status"] == "succeeded", body
    made = calls(tmp_path)
    assert [c["module"] for c in made] == ["pano_stitch", "pano_sfm", "splat_train"]
    stitch = made[0]["argv"]
    inputs = stitch[stitch.index("--input") + 1].split(",")
    assert len(inputs) == 2 and all(i.endswith(".insv") for i in inputs)
    assert "--level-horizon" in stitch and stitch[stitch.index("--trim-start") + 1] == "1.0"
    assert "--trim-start" not in made[1]["argv"]
    assert made[1]["argv"][made[1]["argv"].index("--input") + 1].endswith("equirect.mp4")
    assert body["result"]["stats"]["stitch"]["camera_model"] == "X5"


def test_splat_from_equirect_images_passes_a_directory(http_files, fake_stages, mgr, tmp_path):
    urls = [http_files + "/a.jpg", http_files + "/b.jpg"]
    tid = mgr.submit(req(source_kind="equirect_images", source_url=None, source_urls=urls), urls)
    assert wait_for(mgr, tid)["status"] == "succeeded"
    sfm = calls(tmp_path)[0]["argv"]
    assert "--fps" not in sfm and "--trim-start" not in sfm


def test_stitch_task_returns_only_equirect(http_files, fake_stages, mgr, tmp_path):
    tid = mgr.submit(req(task="stitch", source_kind="insp", source_url=http_files + "/a.jpg"), [http_files + "/a.jpg"])
    body = wait_for(mgr, tid)
    assert body["status"] == "succeeded", body
    assert body["result"]["equirect_url"].endswith("equirect.jpg")
    assert "ply_url" not in body["result"]
    assert [c["module"] for c in calls(tmp_path)] == ["pano_stitch"]


def test_stage_failure_surfaces_code_and_message_unchanged(http_files, fake_stages, mgr, monkeypatch):
    monkeypatch.setenv("FAKE_PANO_SFM", "exit:4:registration_too_low")
    tid = mgr.submit(req(source_url=http_files + "/v.mp4"), [http_files + "/v.mp4"])
    body = wait_for(mgr, tid)
    assert body["status"] == "failed"
    assert body["error"] == {"code": "registration_too_low", "message": "Fake failure registration_too_low."}


def test_failure_without_stderr_json_uses_exit_code_meaning(http_files, fake_stages, mgr, monkeypatch):
    (fake_stages / "pano_sfm" / "__main__.py").write_text("import sys\nsys.exit(3)\n")
    tid = mgr.submit(req(source_url=http_files + "/v.mp4"), [http_files + "/v.mp4"])
    body = wait_for(mgr, tid)
    assert body["status"] == "failed" and body["error"]["code"] == "corrupt_input"


def test_missing_stage_package_fails_with_clear_error(http_files, tmp_path, monkeypatch, mgr):
    monkeypatch.setattr(stages, "STAGES_DIR", write_fake_stages(tmp_path / "partial", only={"pano_sfm"}))
    tid = mgr.submit(req(source_url=http_files + "/v.mp4"), [http_files + "/v.mp4"])
    body = wait_for(mgr, tid)
    assert body["status"] == "failed"
    assert body["error"]["code"] == "stage_missing" and "splat_train" in body["error"]["message"]


def test_stage_timeout_stops_the_stage(http_files, fake_stages, mgr, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_PANO_SFM", "hang")
    monkeypatch.setenv("FAKE_PIDFILE", str(tmp_path / "child.pid"))
    monkeypatch.setenv("STAGE_TIMEOUT_PANO_SFM_S", "1")
    monkeypatch.setattr(stages, "TERM_GRACE_S", 2.0)
    tid = mgr.submit(req(source_url=http_files + "/v.mp4"), [http_files + "/v.mp4"])
    body = wait_for(mgr, tid)
    assert body["status"] == "failed" and body["error"]["code"] == "stage_timeout"
    assert not alive(int((tmp_path / "child.pid").read_text()))


def test_unsupported_content_fails_the_task_with_its_code(http_files, fake_stages, mgr):
    tid = mgr.submit(req(source_url=http_files + "/page.html"), [http_files + "/page.html"])
    body = wait_for(mgr, tid)
    assert body["status"] == "failed" and body["error"]["code"] == "unsupported_input"


# -- queueing and cancellation ----------------------------------------------------


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        return Path(f"/proc/{pid}/stat").read_text().split()[2] != "Z"
    except OSError:
        return False


def test_tasks_queue_one_at_a_time_with_positions(http_files, fake_stages, mgr, monkeypatch):
    monkeypatch.setenv("FAKE_PANO_SFM", "slow")
    monkeypatch.setenv("FAKE_SLOW_S", "1.5")
    url = http_files + "/v.mp4"
    first = mgr.submit(req(source_url=url), [url])
    second = mgr.submit(req(source_url=url), [url])
    third = mgr.submit(req(source_url=url), [url])
    wait_for(mgr, first, statuses=("running",))
    assert mgr.get(second)["status"] == "queued" and mgr.get(second)["queue_position"] == 1
    assert mgr.get(third)["queue_position"] == 2
    assert mgr.get(first)["status"] == "running"
    for tid in (first, second, third):
        assert wait_for(mgr, tid)["status"] == "succeeded"


def test_queue_full_is_a_429(http_files, tmp_path):
    m = main.TaskManager(LocalStore(tmp_path / "s"), max_queue=1)
    url = http_files + "/v.mp4"
    m.submit(req(), [url])
    with pytest.raises(main.ApiError) as exc:
        m.submit(req(), [url])
    assert exc.value.status == 429


def test_cancel_queued_task(http_files, fake_stages, mgr, monkeypatch):
    monkeypatch.setenv("FAKE_PANO_SFM", "slow")
    url = http_files + "/v.mp4"
    first = mgr.submit(req(source_url=url), [url])
    second = mgr.submit(req(source_url=url), [url])
    wait_for(mgr, first, statuses=("running",))
    assert mgr.cancel(second) == {"status": "cancelled"}
    assert mgr.get(second)["status"] == "cancelled"
    assert wait_for(mgr, first)["status"] == "succeeded"


def test_cancel_kills_the_whole_process_group(http_files, fake_stages, mgr, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_PANO_SFM", "hang")
    pidfile = tmp_path / "child.pid"
    monkeypatch.setenv("FAKE_PIDFILE", str(pidfile))
    monkeypatch.setattr(stages, "TERM_GRACE_S", 3.0)
    url = http_files + "/v.mp4"
    tid = mgr.submit(req(source_url=url), [url])
    deadline = time.time() + 20
    while not pidfile.exists() and time.time() < deadline:
        time.sleep(0.05)
    child = int(pidfile.read_text())
    assert alive(child)
    assert mgr.cancel(tid) == {"status": "cancelled"}
    assert mgr.get(tid)["status"] == "cancelled"
    deadline = time.time() + 10
    while alive(child) and time.time() < deadline:
        time.sleep(0.05)
    assert not alive(child)


def test_delete_endpoint_cancels(http_files, fake_stages, monkeypatch, tmp_path):
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    monkeypatch.setenv("FAKE_PANO_SFM", "slow")
    monkeypatch.setenv("FAKE_SLOW_S", "5")
    with TestClient(main.app) as client:
        r = client.post("/infer", headers=AUTH, json={"task": "splat", "source_kind": "equirect_video", "source_url": http_files + "/v.mp4"})
        assert r.status_code == 202
        tid = r.json()["task_id"]
        d = client.delete(f"/tasks/{tid}", headers=AUTH)
        assert d.status_code == 200 and d.json() == {"status": "cancelled"}
        assert client.get(f"/tasks/{tid}", headers=AUTH).json()["status"] == "cancelled"


# -- manifest persistence -------------------------------------------------------


def test_finished_task_survives_a_restart(http_files, fake_stages, tmp_path):
    store = LocalStore(tmp_path / "shared")
    first = main.TaskManager(store, work_dir=str(tmp_path))
    first.start()
    url = http_files + "/v.mp4"
    tid = first.submit(req(source_url=url, job_id="job-7"), [url])
    before = wait_for(first, tid)
    first.stop()

    second = main.TaskManager(store, work_dir=str(tmp_path))
    after = second.get(tid)
    assert after["status"] == "succeeded" and after["job_id"] == "job-7"
    assert after["result"] == before["result"]
    assert second.get("f" * 32) is None


def test_orphaned_running_manifest_reports_worker_lost(tmp_path):
    store = LocalStore(tmp_path / "shared")
    tid = "c" * 32
    store.write_json(
        f"{tid}/task.json",
        {"task_id": tid, "task": "splat", "status": "running", "stage": "train", "progress": 0.6, "updated_at": time.time() - 3600},
    )
    body = main.TaskManager(store).get(tid)
    assert body["status"] == "failed" and body["error"]["code"] == "worker_lost"
    store.write_json(
        f"{tid}/task.json",
        {"task_id": tid, "task": "splat", "status": "running", "stage": "train", "progress": 0.6, "updated_at": time.time()},
    )
    assert main.TaskManager(store).get(tid)["status"] == "running"


# -- signed URLs -----------------------------------------------------------------


def test_signed_url_shape(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from google.cloud import storage
    from google.oauth2 import service_account

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    creds = service_account.Credentials.from_service_account_info(
        {
            "type": "service_account",
            "project_id": "p",
            "private_key_id": "k1",
            "private_key": pem,
            "client_email": "runtime@p.iam.gserviceaccount.com",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    )
    store = GcsStore("three-ws-pano-captures")
    store._creds = creds
    store._client = storage.Client(project="p", credentials=creds)
    url = store.signed_url("abc/scene.spz")
    parts = urlsplit(url)
    q = parse_qs(parts.query)
    assert parts.scheme == "https" and parts.netloc == "storage.googleapis.com"
    assert parts.path == "/three-ws-pano-captures/abc/scene.spz"
    assert q["X-Goog-Algorithm"] == ["GOOG4-RSA-SHA256"]
    assert q["X-Goog-Expires"] == ["604800"]
    assert q["X-Goog-Credential"][0].startswith("runtime@p.iam.gserviceaccount.com/")
    assert q["X-Goog-Signature"][0]


# -- health ------------------------------------------------------------------------


def test_health_reports_stage_packages(monkeypatch, tmp_path):
    import health

    health._cache.clear()
    monkeypatch.setattr(stages, "STAGES_DIR", write_fake_stages(tmp_path / "partial", only={"pano_sfm"}))
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    with TestClient(main.app) as client:
        body = client.get("/health").json()
    assert body["ok"] is True and body["max_source_bytes"] == 8 * 1024**3
    assert isinstance(body["gpu_available"], bool)
    assert body["stages"]["pano_sfm"] == {"present": True, "imports": True}
    assert body["stages"]["splat_train"] == {"present": False, "imports": False}
    health._cache.clear()


def test_stage_crash_message_carries_the_last_output_and_signal(monkeypatch, tmp_path):
    import stages

    pkg = tmp_path / "pano_sfm"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "__main__.py").write_text(
        "import os, sys\nsys.stderr.write('terminate called after throwing an instance of std::bad_alloc\\n')\n"
        "sys.stderr.flush()\nos.abort()\n"
    )
    monkeypatch.setattr(stages, "STAGES_DIR", tmp_path)
    runner = stages.StageRunner()
    with pytest.raises(stages.StageError) as exc:
        runner.run("pano_sfm", [], lambda *_: None)
    assert "signal 6" in exc.value.message
    assert "bad_alloc" in exc.value.message
