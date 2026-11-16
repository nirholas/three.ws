"""Cross-instance task visibility (task_store.py). Stdlib only:

    python3 workers/rembg/test_task_store.py

The bug this pins: task state lived only in the memory of the instance that
accepted the job, so a poll that Cloud Run routed to a different instance (a
scale-out, a new revision, or a traffic split between revisions) answered 404
for a job that was running fine elsewhere. model-trellis treats that 404 as a
failed matte and reconstructs from the un-matted photo.

The store under test writes each task record to the shared bucket, so any
instance can answer a poll. The bucket here is a dict-backed stand-in with the
two blob calls google-cloud-storage exposes; the production path hands in the
real `storage.Bucket`.
"""

from __future__ import annotations

import json
import sys

from task_store import TaskNotFound, load_task, persist_task, task_blob_name

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


class NotFound(Exception):
    """Same role as google.api_core.exceptions.NotFound."""


class _Blob:
    def __init__(self, store: dict, name: str):
        self._store, self.name = store, name

    def upload_from_string(self, data, content_type=None):
        self._store[self.name] = (data if isinstance(data, bytes) else data.encode(), content_type)

    def download_as_bytes(self):
        if self.name not in self._store:
            raise NotFound(self.name)
        return self._store[self.name][0]


class SharedBucket:
    def __init__(self):
        self.objects: dict = {}

    def blob(self, name: str) -> _Blob:
        return _Blob(self.objects, name)


TASK_ID = "3f2c6a8e-1b7d-4c55-9a0e-5d1f2b3c4d5e"
bucket = SharedBucket()

# Instance A accepts the job; instance B has never heard of it.
instance_a = {TASK_ID: {"task_id": TASK_ID, "status": "queued", "model": "isnet-general-use",
                        "created_at": 100.0}}
persist_task(bucket, instance_a[TASK_ID])

seen_by_b = load_task(bucket, TASK_ID, not_found=(NotFound,))
check("a task accepted on one instance is visible on another", seen_by_b["status"] == "queued",
      str(seen_by_b))
check("the record carries the resolved model", seen_by_b["model"] == "isnet-general-use")

instance_a[TASK_ID].update({"status": "done", "result_url": "https://storage.googleapis.com/b/rembg/x.png",
                            "width": 10, "height": 20, "elapsed_ms": 812, "finished_at": 101.0})
persist_task(bucket, instance_a[TASK_ID])
seen_by_b = load_task(bucket, TASK_ID, not_found=(NotFound,))
check("the terminal state reaches the other instance", seen_by_b["status"] == "done", str(seen_by_b))
check("the result URL reaches the other instance",
      seen_by_b["result_url"].endswith("/rembg/x.png"))

stored = json.loads(bucket.objects[task_blob_name(TASK_ID)][0])
check("retention timestamps stay server-side",
      "created_at" not in stored and "finished_at" not in stored, str(sorted(stored)))
check("records are written as JSON", bucket.objects[task_blob_name(TASK_ID)][1] == "application/json")
check("records live under the rembg/tasks/ prefix",
      task_blob_name(TASK_ID) == f"rembg/tasks/{TASK_ID}.json")

try:
    load_task(bucket, "8a1d2c3b-0000-4000-8000-000000000000", not_found=(NotFound,))
    check("an unknown id is reported as not found", False, "no error raised")
except TaskNotFound:
    check("an unknown id is reported as not found", True)

for hostile in ("../../secrets", "rembg/tasks/x", "", "not-a-uuid"):
    try:
        load_task(bucket, hostile, not_found=(NotFound,))
        check(f"non-UUID id {hostile!r} is refused", False, "no error raised")
    except TaskNotFound:
        check(f"non-UUID id {hostile!r} is refused before touching the bucket", True)

print(f"\n{PASS} checks passed")
