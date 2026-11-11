"""Tests for task_heartbeat: the out-of-process proof of life for live tasks.

Production, 2026-11-11: TRELLIS jobs on one instance were failed as "task
orphaned: its runner instance stopped mid-job" by a poll that landed on the
OTHER instance, three to four minutes after submit, while the owning instance
was still working on them and later logged "done in 313.5s". The record's last
heartbeat was more than ORPHAN_AFTER_SECS old because the beat ran on the same
interpreter as the job: the GLB postprocess (xatlas, pymeshfix) holds the GIL for
minutes, so neither the event loop nor any thread in that process could write.
The poller's verdict was persisted, the router failed over to an untextured lane,
and the finished GLB was thrown away.

The fix moves the beat into its own process. These tests prove the beat keeps
landing while the job's process holds the GIL, and that the conditional refresh
can never resurrect a task whose runner already wrote a terminal record.
"""

from __future__ import annotations

import fcntl
import json
import os
import sys
import time
from pathlib import Path

import pytest

import task_heartbeat
from task_heartbeat import TaskBeater, live_task_ids, refresh_task

HERE = Path(__file__).resolve().parent


# ------------------------------------------------------------------ test double
# A filesystem stand-in for a GCS bucket with the two semantics refresh_task
# relies on: every write bumps the object's generation, and a write or read
# conditioned on a generation fails with HTTP 412 when the object has moved on.
# Writes also append the record's updated_at to a sidecar log so a test can see
# every beat that landed, including ones written while the test was GIL-blocked.


class _HttpError(Exception):
    def __init__(self, code: int):
        super().__init__(f"HTTP {code}")
        self.code = code


class FileBlob:
    def __init__(self, root: Path, name: str):
        self._root = root
        self.name = name
        self._path = root / name
        self.generation = self._read_generation()

    def _read_generation(self):
        gen = self._path.with_suffix(".gen")
        return int(gen.read_text()) if gen.exists() else None

    def download_as_bytes(self, if_generation_match=None):
        with _locked(self._root):
            current = self._read_generation()
            if current is None:
                raise _HttpError(404)
            if if_generation_match is not None and current != if_generation_match:
                raise _HttpError(412)
            return self._path.read_bytes()

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        with _locked(self._root):
            current = self._read_generation()
            if if_generation_match is not None and current != if_generation_match:
                raise _HttpError(412)
            self._path.parent.mkdir(parents=True, exist_ok=True)
            payload = data.encode() if isinstance(data, str) else data
            self._path.write_bytes(payload)
            self._path.with_suffix(".gen").write_text(str((current or 0) + 1))
            with self._path.with_suffix(".beats").open("a") as log:
                log.write(f"{json.loads(payload).get('updated_at')}\n")


class FileBucket:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def blob(self, name):
        return FileBlob(self.root, name)

    def get_blob(self, name):
        blob = FileBlob(self.root, name)
        return blob if blob.generation is not None else None


class _locked:
    def __init__(self, root: Path):
        self._file = (root / ".lock").open("a")

    def __enter__(self):
        fcntl.flock(self._file, fcntl.LOCK_EX)

    def __exit__(self, *exc):
        fcntl.flock(self._file, fcntl.LOCK_UN)
        self._file.close()


TASK = "3ff0ce3b-506b-4c76-a015-d3c0de054ad4"
NOW = 1_800_000_000.0


def _put(bucket: FileBucket, record: dict) -> None:
    bucket.blob(f"tasks/{record['task_id']}.json").upload_from_string(json.dumps(record))


def _get(bucket: FileBucket, task_id: str = TASK) -> dict:
    return json.loads(bucket.blob(f"tasks/{task_id}.json").download_as_bytes())


# ---------------------------------------------------------------- refresh_task


def test_a_live_record_gets_a_fresh_timestamp_and_keeps_every_other_field(tmp_path):
    bucket = FileBucket(tmp_path)
    _put(bucket, {"task_id": TASK, "status": "running", "updated_at": NOW - 200, "tier": "max"})
    assert refresh_task(bucket, TASK, NOW) == "refreshed"
    assert _get(bucket) == {"task_id": TASK, "status": "running", "updated_at": NOW, "tier": "max"}


def test_a_queued_record_is_refreshed_too(tmp_path):
    bucket = FileBucket(tmp_path)
    _put(bucket, {"task_id": TASK, "status": "queued", "updated_at": NOW - 90})
    assert refresh_task(bucket, TASK, NOW) == "refreshed"
    assert _get(bucket)["updated_at"] == NOW


@pytest.mark.parametrize("status", ["done", "failed"])
def test_a_terminal_record_is_never_rewritten(tmp_path, status):
    bucket = FileBucket(tmp_path)
    _put(bucket, {"task_id": TASK, "status": status, "updated_at": NOW - 5})
    assert refresh_task(bucket, TASK, NOW) == "terminal"
    assert _get(bucket) == {"task_id": TASK, "status": status, "updated_at": NOW - 5}


def test_a_record_not_written_yet_is_skipped(tmp_path):
    assert refresh_task(FileBucket(tmp_path), TASK, NOW) == "missing"


def test_a_runner_write_between_read_and_refresh_wins(tmp_path):
    # The runner writes "done" after the beat read the record as running. The
    # beat's generation-conditioned write must lose, or a finished task would be
    # resurrected as running and its client would poll until it was orphaned.
    bucket = FileBucket(tmp_path)
    _put(bucket, {"task_id": TASK, "status": "running", "updated_at": NOW - 40})

    class RunnerFinishesMidBeat(FileBucket):
        def blob(self, name):
            inner = super().blob(name)
            original = inner.upload_from_string

            def upload(data, content_type=None, if_generation_match=None):
                _put(bucket, {"task_id": TASK, "status": "done", "updated_at": NOW - 1})
                return original(data, content_type, if_generation_match)

            inner.upload_from_string = upload
            return inner

    assert refresh_task(RunnerFinishesMidBeat(tmp_path), TASK, NOW) == "raced"
    assert _get(bucket)["status"] == "done"


def test_unexpected_storage_errors_surface(tmp_path):
    class Broken(FileBucket):
        def get_blob(self, name):
            raise _HttpError(503)

    with pytest.raises(_HttpError):
        refresh_task(Broken(tmp_path), TASK, NOW)


# ---------------------------------------------------------------- live markers


def test_live_markers_round_trip_and_ignore_foreign_files(tmp_path):
    task_heartbeat.mark_live(tmp_path, TASK)
    (tmp_path / "not-a-task.tmp").write_text("")
    assert live_task_ids(tmp_path) == [TASK]
    task_heartbeat.clear_live(tmp_path, TASK)
    task_heartbeat.clear_live(tmp_path, TASK)
    assert live_task_ids(tmp_path) == []


def test_a_missing_live_dir_means_no_live_tasks(tmp_path):
    assert live_task_ids(tmp_path / "absent") == []


# ---------------------------------------------------- the production failure
# The job holds the GIL; the beat must keep landing anyway.


def _hold_the_gil(seconds: float) -> None:
    """Keep this interpreter's GIL for `seconds`, the way a long C extension call
    (xatlas parametrize, pymeshfix) does: no other thread in the process runs."""
    previous = sys.getswitchinterval()
    sys.setswitchinterval(seconds * 10)
    try:
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            pass
    finally:
        sys.setswitchinterval(previous)


def _beater_for(store: Path, live: Path, interval: float) -> TaskBeater:
    # Same process model as production (python -m task_heartbeat), with the
    # filesystem bucket swapped in for GCS.
    bootstrap = (
        "import sys; sys.path[:0] = [{here!r}];"
        "import task_heartbeat, test_task_heartbeat as t;"
        "task_heartbeat.beat_forever(t.FileBucket({store!r}), {live!r}, {interval!r}, {ppid!r})"
    ).format(here=str(HERE), store=str(store), live=str(live), interval=interval, ppid=os.getpid())
    return TaskBeater(live_dir=live, command=[sys.executable, "-c", bootstrap])


def test_beats_keep_landing_while_the_job_process_holds_the_gil(tmp_path):
    store, live = tmp_path / "bucket", tmp_path / "live"
    bucket = FileBucket(store)
    _put(bucket, {"task_id": TASK, "status": "running", "updated_at": time.time()})
    beater = _beater_for(store, live, interval=0.1)
    beater.start()
    try:
        beater.add(TASK)
        # Wait (with the GIL free) until the beater is demonstrably beating.
        deadline = time.time() + 20
        while _get(bucket)["updated_at"] < time.time() - 0.5 and time.time() < deadline:
            time.sleep(0.05)
        blocked_from = time.time()
        _hold_the_gil(2.0)
        blocked_until = time.time()
    finally:
        beater.stop()

    beats = [
        float(line)
        for line in (store / f"tasks/{TASK}.beats").read_text().split()
        if line != "None"
    ]
    during = [b for b in beats if blocked_from + 0.3 <= b <= blocked_until - 0.3]
    assert during, (
        f"no beat landed during the {blocked_until - blocked_from:.1f}s the job held the GIL; "
        "another instance would have declared this live task orphaned"
    )


def test_a_dead_beater_is_restarted_when_the_next_task_arrives(tmp_path):
    store, live = tmp_path / "bucket", tmp_path / "live"
    beater = _beater_for(store, live, interval=0.1)
    beater.start()
    try:
        first = beater.pid
        beater._proc.kill()
        beater._proc.wait()
        beater.add(TASK)
        assert beater.pid is not None and beater.pid != first
    finally:
        beater.stop()


def test_stop_clears_every_live_marker(tmp_path):
    beater = _beater_for(tmp_path / "bucket", tmp_path / "live", interval=0.1)
    beater.start()
    beater.add(TASK)
    beater.discard(TASK)
    beater.add(TASK)
    beater.stop()
    assert live_task_ids(tmp_path / "live") == []


def test_the_beater_exits_on_its_own_when_its_parent_dies(tmp_path):
    # A Cloud Run instance that loses its server process must not keep a task
    # alive forever: the beat stops as soon as its parent is gone.
    import subprocess

    store, live = tmp_path / "bucket", tmp_path / "live"
    parent = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import os, sys, time; sys.path[:0] = [{here!r}];"
                "import task_heartbeat, test_task_heartbeat as t;"
                "b = t._beater_for(t.Path({store!r}), t.Path({live!r}), 0.1); b.start();"
                "print(b.pid, flush=True); time.sleep(60)"
            ).format(here=str(HERE), store=str(store), live=str(live)),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    child_pid = int(parent.stdout.readline())
    parent.kill()
    parent.wait()
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    os.kill(child_pid, 9)
    pytest.fail("the beater outlived its parent")
