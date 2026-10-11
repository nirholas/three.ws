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
