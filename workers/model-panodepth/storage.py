"""Result storage: upload task outputs, sign URLs, persist task manifests.

The manifest ``depth/<task_id>/task.json`` is the durable record of a finished
task, so a restarted instance can still answer ``GET /tasks/{id}``. Signed URLs
are regenerated from the stored object keys on every read, so each is fresh for
its full 7 days.
"""

from __future__ import annotations

import json
import mimetypes
import os
import shutil
from datetime import timedelta
from pathlib import Path
from typing import Optional

SIGNED_URL_TTL = timedelta(days=7)

CONTENT_TYPES = {
    ".glb": "model/gltf-binary",
    ".ply": "application/octet-stream",
    ".exr": "image/x-exr",
    ".json": "application/json",
}


def content_type_for(key: str) -> str:
    ext = os.path.splitext(key)[1].lower()
    return CONTENT_TYPES.get(ext) or mimetypes.guess_type(key)[0] or "application/octet-stream"


class GcsStore:
    """Cloud Storage store. Signing goes through the runtime service account's IAM
    signBlob (needs roles/iam.serviceAccountTokenCreator on itself)."""

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self._client = None
        self._creds = None

    def _bucket(self):
        if self._client is None:
            import google.auth
            from google.cloud import storage

            self._creds, project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            self._client = storage.Client(project=project, credentials=self._creds)
        return self._client.bucket(self.bucket_name)

    def upload_file(self, key: str, path: Path) -> None:
        self._bucket().blob(key).upload_from_filename(str(path), content_type=content_type_for(key))

    def write_json(self, key: str, obj: dict) -> None:
        self._bucket().blob(key).upload_from_string(json.dumps(obj, separators=(",", ":")), content_type="application/json")

    def read_json(self, key: str) -> Optional[dict]:
        blob = self._bucket().blob(key)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_bytes())

    def signed_url(self, key: str) -> str:
        from google.oauth2 import service_account

        blob = self._bucket().blob(key)
        creds = self._creds
        if isinstance(creds, service_account.Credentials):
            return blob.generate_signed_url(version="v4", expiration=SIGNED_URL_TTL, method="GET")
        from google.auth.transport.requests import Request

        if not creds.valid:
            creds.refresh(Request())
        return blob.generate_signed_url(
            version="v4",
            expiration=SIGNED_URL_TTL,
            method="GET",
            service_account_email=os.environ.get("SIGNING_SA") or creds.service_account_email,
            access_token=creds.token,
        )


class LocalStore:
    """Directory-backed store with the same interface, for tests. ``signed_url``
    returns a file:// URI; there is nothing to sign locally."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def upload_file(self, key: str, path: Path) -> None:
        dst = self.root / key
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dst)

    def write_json(self, key: str, obj: dict) -> None:
        dst = self.root / key
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(json.dumps(obj))

    def read_json(self, key: str) -> Optional[dict]:
        src = self.root / key
        return json.loads(src.read_text()) if src.is_file() else None

    def signed_url(self, key: str) -> str:
        return (self.root / key).resolve().as_uri()
