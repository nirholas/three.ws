from __future__ import annotations

import json
import uuid

import pytest

from storage_backend import LocalStorage, normalize_task_id


def test_task_round_trip_survives_process_memory(tmp_path):
    storage = LocalStorage(tmp_path)
    task_id = str(uuid.uuid4())
    task = {"task_id": task_id, "status": "done", "updated_at": 123.0}

    path = storage.write_task(task)

    assert path == tmp_path / "tasks" / f"{task_id}.json"
    assert storage.read_task(task_id) == task
    assert json.loads(path.read_text()) == task


def test_result_is_written_to_the_mounted_volume(tmp_path):
    storage = LocalStorage(tmp_path)
    task_id = str(uuid.uuid4())
    payload = b"glTF" + bytes(range(32))

    path = storage.write_result(task_id, payload)

    assert path == tmp_path / "results" / f"{task_id}.glb"
    assert path.read_bytes() == payload


@pytest.mark.parametrize(
    "task_id",
    ["../escape", "not-a-uuid", "{00000000-0000-0000-0000-000000000000}", "00000000-0000-0000-0000-000000000000/mesh"],
)
def test_task_ids_cannot_escape_the_output_volume(task_id):
    with pytest.raises(ValueError):
        normalize_task_id(task_id)


def test_atomic_writes_leave_no_temporary_files(tmp_path):
    storage = LocalStorage(tmp_path)
    task_id = str(uuid.uuid4())

    storage.write_task({"task_id": task_id, "status": "queued"})
    storage.write_task({"task_id": task_id, "status": "running"})
    storage.write_result(task_id, b"first")
    storage.write_result(task_id, b"second")

    assert storage.read_task(task_id)["status"] == "running"
    assert storage.result_path(task_id).read_bytes() == b"second"
    assert list(tmp_path.rglob("*.tmp")) == []


# ------------------------------------------------------- GCS task record caching
# Production, 2026-11-14 (europe-west4, task aafe60b5): a cold 3-image job was
# failed as "task orphaned: its runner instance stopped mid-job" 190 s after
# submit while its one and only instance was alive, heartbeating, and loading
# the multi-view pipeline. Every poll in between read the first generation of
# the record (status "queued", no resolution, updated_at frozen at submit) even
# though the runner had since written "running" and a beat every 30 s. The task
# bucket is publicly readable, and a public object uploaded without
# Cache-Control gets "public, max-age=3600", which lets a read be answered from
# Google's edge cache with an old generation. Once that frozen copy passed
# ORPHAN_AFTER_SECS the poll persisted a failure over a live task. The same
# fault and fix landed for TRELLIS.2 and Modly on 2026-11-11.


class _EdgeCachedBlob:
    """A public GCS object behind Google's edge cache, per the documented rule:
    a read may be answered from cache unless Cache-Control forbids caching."""

    UNCACHEABLE = ("no-store", "no-cache", "private", "max-age=0")

    def __init__(self):
        self.cache_control = None
        self._stored_cache_control = None
        self._live = None
        self._cached = None
        self.content_type = None

    def upload_from_string(self, data, content_type=None):
        self._live = data
        self.content_type = content_type
        self._stored_cache_control = self.cache_control

    def download_as_bytes(self):
        policy = (self._stored_cache_control or "public, max-age=3600").lower()
        if any(token in policy for token in self.UNCACHEABLE):
            return self._live.encode()
        if self._cached is None:
            self._cached = self._live
        return self._cached.encode()


def test_a_task_record_is_never_served_stale_from_the_edge_cache():
    from storage_backend import upload_task_record

    blob = _EdgeCachedBlob()
    upload_task_record(blob, json.dumps({"status": "queued", "updated_at": 100.0}))
    assert json.loads(blob.download_as_bytes())["updated_at"] == 100.0

    upload_task_record(blob, json.dumps({"status": "running", "updated_at": 130.0}))
    upload_task_record(blob, json.dumps({"status": "done", "updated_at": 160.0}))
    seen = json.loads(blob.download_as_bytes())
    assert seen == {"status": "done", "updated_at": 160.0}, (
        "a poll read an old generation of the task record; "
        "it would judge a live task orphaned"
    )
    assert blob.content_type == "application/json"
