"""Storage primitives for the standalone TRELLIS container.

Production persists tasks and results in GCS because requests can move between
Cloud Run instances. An NGC user runs one container with a mounted output
volume, so the same service needs a local backend with atomic writes and strict
task-id validation.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path


def normalize_task_id(task_id: str) -> str:
    """Return a canonical UUID or reject a value that could escape the volume."""
    parsed = uuid.UUID(task_id)
    canonical = str(parsed)
    if task_id.lower() != canonical:
        raise ValueError("task_id must be a canonical UUID")
    return canonical


class LocalStorage:
    """Durable task metadata and GLB results on a mounted local volume."""

    def __init__(self, output_dir: str | os.PathLike[str]):
        self.output_dir = Path(output_dir).expanduser().resolve()
        self.tasks_dir = self.output_dir / "tasks"
        self.results_dir = self.output_dir / "results"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)

    def task_path(self, task_id: str) -> Path:
        return self.tasks_dir / f"{normalize_task_id(task_id)}.json"

    def result_path(self, task_id: str) -> Path:
        return self.results_dir / f"{normalize_task_id(task_id)}.glb"

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        with temporary.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)

    def write_task(self, task: dict) -> Path:
        path = self.task_path(str(task["task_id"]))
        payload = json.dumps(task, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self._atomic_write(path, payload)
        return path

    def read_task(self, task_id: str) -> dict:
        return json.loads(self.task_path(task_id).read_text(encoding="utf-8"))

    def write_result(self, task_id: str, glb_bytes: bytes) -> Path:
        path = self.result_path(task_id)
        self._atomic_write(path, glb_bytes)
        return path
