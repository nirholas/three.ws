"""Shared task records, so a poll can land on any instance or revision.

The in-memory task map in main.py is the fast path. It is per instance, though,
and Cloud Run routes each poll independently: a scale-out, a new revision, or a
traffic split between revisions sends some polls to an instance that never saw
the job. Every state change is therefore also written to the output bucket
under ``rembg/tasks/<task_id>.json``, and a poll that misses memory reads it
from there.

Stdlib only. The bucket is anything with ``blob(name)`` returning an object
that has ``upload_from_string`` and ``download_as_bytes`` (google-cloud-storage
in production), so the rules run in the Docker build gate without GCP.
"""

from __future__ import annotations

import json
import uuid

TASK_PREFIX = "rembg/tasks/"

# Bookkeeping prune_tasks() reads; never stored or sent on the wire.
INTERNAL_FIELDS = ("created_at", "finished_at")


class TaskNotFound(KeyError):
    """No record exists for this id, or the id is not one this service issues."""


def _checked_id(task_id: str) -> str:
    """Task ids are uuid4 strings this service minted. Refusing anything else
    keeps caller input out of object names entirely."""
    try:
        return str(uuid.UUID(task_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise TaskNotFound(task_id) from exc


def task_blob_name(task_id: str) -> str:
    return f"{TASK_PREFIX}{_checked_id(task_id)}.json"


def public_view(task: dict) -> dict:
    """The documented response shape: everything except retention bookkeeping."""
    return {key: value for key, value in task.items() if key not in INTERNAL_FIELDS}


def persist_task(bucket, task: dict) -> None:
    """Write the task's public view to the shared bucket (blocking)."""
    body = json.dumps(public_view(task), separators=(",", ":"))
    bucket.blob(task_blob_name(task["task_id"])).upload_from_string(
        body, content_type="application/json"
    )


def load_task(bucket, task_id: str, not_found: tuple = ()) -> dict:
    """Read a task record another instance wrote (blocking).

    ``not_found`` lists the storage client's missing-object exception types
    (``google.api_core.exceptions.NotFound`` in production); they surface as
    TaskNotFound so the route answers 404 without knowing about GCS.
    """
    name = task_blob_name(task_id)
    try:
        raw = bucket.blob(name).download_as_bytes()
    except not_found as exc:
        raise TaskNotFound(task_id) from exc
    return json.loads(raw)
