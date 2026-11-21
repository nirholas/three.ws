import hashlib
import os
import threading
import time

import pytest

from c4_server import API_KEY, C4Server
from three_ws.capture360_client import (
    Cancelled,
    Capture360Client,
    lane_for,
    source_kind_for,
)
from three_ws.three_ws_client import ThreeWSError


@pytest.fixture
def server():
    s = C4Server(part_size=64 * 1024, polls_to_finish=3).start()
    yield s
    s.stop()


def make_file(tmp_path, size, name="clip.mp4"):
    path = tmp_path / name
    path.write_bytes(os.urandom(size))
    return str(path)


def client(server, tmp_path, **kw):
    kw.setdefault("retry_delay", 0.01)
    return Capture360Client(server.url, api_key=API_KEY, state_dir=str(tmp_path / "state"), **kw)


def test_kind_and_lane_mapping():
    assert source_kind_for("a.INSV") == "insv"
    assert source_kind_for("a.insp") == "insp"
    assert source_kind_for("a.mov") == "equirect_video"
    assert source_kind_for("a.jpg") == "equirect_image"
    assert lane_for("a.insv") == "splat" and lane_for("a.mp4") == "splat"
    assert lane_for("a.insp") == "shell" and lane_for("a.jpg") == "shell"
    with pytest.raises(ThreeWSError):
        source_kind_for("a.txt")


def test_multipart_upload_is_byte_identical_with_four_parallel_parts(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 9 + 123)
    server.put_delay = 0.05
    seen = []
    result = client(server, tmp_path).upload_file(path, progress=lambda f, d, n: seen.append((f, d, n)))
    key = result["source_url"].split("/_files/")[1]
    assert hashlib.sha256(server.files[key]).digest() == hashlib.sha256(open(path, "rb").read()).digest()
    assert result["size_bytes"] == os.path.getsize(path)
    assert seen[-1][0] == 1.0 and seen[-1][2] == 10
    # parallelism: 10 parts at 50 ms each finish in well under the serial 500 ms
    assert len(server.put_log) == 10


def test_parts_really_overlap(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 8)
    server.put_delay = 0.25
    started = time.monotonic()
    client(server, tmp_path).upload_file(path)
    elapsed = time.monotonic() - started
    assert elapsed < 8 * 0.25 * 0.6, f"parts ran serially ({elapsed:.2f}s)"


def test_retries_transient_5xx(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 3)
    server.fail_puts = 3
    result = client(server, tmp_path).upload_file(path)
    assert result["source_url"]


def test_expired_part_url_is_resigned(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 2)
    server.expire_first_put_with_403 = True
    client(server, tmp_path).upload_file(path)
    assert sum(1 for m, p in server.log if p == "/api/capture-upload/sign") >= 2


def test_resume_skips_parts_already_stored(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 6)
    c = client(server, tmp_path, parallel=1, part_attempts=1)
    count = {"n": 0}
    original = c._put_part

    def flaky(url, data):
        count["n"] += 1
        if count["n"] == 4:
            raise ThreeWSError("network dropped", code="unreachable")
        return original(url, data)

    c._put_part = flaky
    with pytest.raises(ThreeWSError):
        c.upload_file(path)
    stored = sorted(n for _, n in server.put_log)
    assert stored == [1, 2, 3]
    server.put_log.clear()
    creates_before = sum(1 for m, p in server.log if p.endswith("/create"))
    c2 = client(server, tmp_path)
    result = c2.upload_file(path)
    assert sorted(n for _, n in server.put_log) == [4, 5, 6]
    assert sum(1 for m, p in server.log if p.endswith("/create")) == creates_before
    key = result["source_url"].split("/_files/")[1]
    assert server.files[key] == open(path, "rb").read()


def test_cancel_aborts_the_upload_and_drops_resume_state(server, tmp_path):
    path = make_file(tmp_path, 64 * 1024 * 6)
    flag = threading.Event()
    server.put_delay = 0.1
    c = client(server, tmp_path, parallel=1)
    threading.Timer(0.15, flag.set).start()
    with pytest.raises(Cancelled):
        c.upload_file(path, should_cancel=flag.is_set)
    assert server.uploads == {}
    assert not os.path.isdir(tmp_path / "state" / "uploads") or not os.listdir(tmp_path / "state" / "uploads")


def test_capture_job_polls_to_result_and_lists(server, tmp_path):
    server.results = {"capture": {"ply_url": "scene.ply", "preview_url": "preview.mp4"}}
    server.files["scene.ply"] = b"ply"
    c = client(server, tmp_path)
    created = c.create_capture("https://x/y.mp4", "equirect_video", trim={"start_s": 1, "end_s": 5}, quality="preview")
    job = created["job_id"]
    assert server.jobs[job]["body"]["trim"] == {"start_s": 1, "end_s": 5}
    updates = []
    body = c.wait_for_job(lambda: c.get_capture(job), on_update=updates.append, interval=0.01)
    assert body["status"] == "succeeded" and body["result"]["ply_url"].endswith("/scene.ply")
    assert any(u.get("stage") for u in updates)
    assert [x["job_id"] for x in c.list_captures()] == [job]
    dest = tmp_path / "scene.ply"
    c.download(body["result"]["ply_url"], str(dest))
    assert dest.read_bytes() == b"ply"


def test_cancel_a_running_capture_sends_delete(server, tmp_path):
    c = client(server, tmp_path)
    job = c.create_capture("https://x/y.mp4", "equirect_video")["job_id"]
    c.cancel_capture(job)
    assert ("DELETE", f"/api/pano-capture?job={job}") in server.log
    with pytest.raises(Cancelled):
        c.wait_for_job(lambda: c.get_capture(job), interval=0.01)


def test_failed_job_surfaces_the_visitor_message(tmp_path):
    c = Capture360Client("http://x", api_key="k")
    with pytest.raises(ThreeWSError) as err:
        c.wait_for_job(lambda: {"status": "failed", "error": {"code": "bad", "message": "Too few overlapping frames."}}, interval=0.01)
    assert err.value.message == "Too few overlapping frames."


def test_pano_scene_round_trip(server, tmp_path):
    server.results = {"scene": {"glb_url": "scene.glb"}}
    c = client(server, tmp_path)
    job = c.create_scene("https://x/p.jpg", "equirect_image")["job_id"]
    body = c.wait_for_job(lambda: c.get_scene(job), interval=0.01)
    assert body["result"]["glb_url"].endswith("/scene.glb")


def test_offline_guard_blocks_every_request(server, tmp_path):
    c = Capture360Client(server.url, api_key=API_KEY, online_guard=lambda: "Online access is disabled.", state_dir=str(tmp_path))
    path = make_file(tmp_path, 1000)
    calls = [
        lambda: c.upload_file(path),
        lambda: c.create_capture("https://x/y.mp4", "equirect_video"),
        lambda: c.list_captures(),
        lambda: c.get_scene("a"),
        lambda: c.cancel_capture("a"),
        lambda: c.download(server.url + "/_files/x", str(tmp_path / "o")),
    ]
    for call in calls:
        with pytest.raises(ThreeWSError) as err:
            call()
        assert err.value.code == "offline"
    assert server.log == [] and server.put_log == []


def test_wrong_key_gives_a_sign_in_message(server, tmp_path):
    c = Capture360Client(server.url, api_key="wrong")
    with pytest.raises(ThreeWSError) as err:
        c.list_captures()
    assert err.value.status == 401 and "API key" in err.value.message


def test_rejects_unsupported_and_empty_files(server, tmp_path):
    c = client(server, tmp_path)
    bad = tmp_path / "a.txt"
    bad.write_text("x")
    with pytest.raises(ThreeWSError) as err:
        c.upload_file(str(bad))
    assert err.value.code == "invalid_content_type"
    empty = tmp_path / "e.mp4"
    empty.write_bytes(b"")
    with pytest.raises(ThreeWSError) as err:
        c.upload_file(str(empty))
    assert err.value.code == "empty_file"
