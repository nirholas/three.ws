"""Result storage: upload task outputs, sign URLs, persist task manifests.

The manifest (``<task_id>/task.json``) is the durable record of a task. Any
instance can answer ``GET /tasks/{id}`` for a finished task after a restart, and
signed URLs are regenerated from the stored object keys on every read, so they
are always fresh for their 7 days even when the manifest is older.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import shutil
from datetime import timedelta
from pathlib import Path
from typing import Optional

log = logging.getLogger("pano2splat.results")

SIGNED_URL_TTL = timedelta(days=7)

CONTENT_TYPES = {
    ".ply": "application/octet-stream",
    ".spz": "application/octet-stream",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".json": "application/json",
}


def content_type_for(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return CONTENT_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


class GcsStore:
    """Cloud Storage backed store. Signing uses the runtime service account's IAM signBlob."""

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self._client = None
        self._creds = None

    def _bucket(self):
        if self._client is None:
            import google.auth
            from google.cloud import storage

            self._creds, project = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            self._client = storage.Client(project=project, credentials=self._creds)
        return self._client.bucket(self.bucket_name)

    def upload_file(self, key: str, path: Path) -> None:
        self._bucket().blob(key).upload_from_filename(str(path), content_type=content_type_for(key))

    def write_json(self, key: str, obj: dict) -> None:
        self._bucket().blob(key).upload_from_string(
            json.dumps(obj, separators=(",", ":")), content_type="application/json"
        )

    def read_json(self, key: str) -> Optional[dict]:
        blob = self._bucket().blob(key)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_bytes())

    def signed_url(self, key: str) -> str:
        """V4 URL valid for 7 days.

        A service-account key signs locally. Metadata-server credentials (Cloud
        Run) have no key, so the library is handed the account email and a fresh
        access token and signs through IAM signBlob, which needs
        roles/iam.serviceAccountTokenCreator on the runtime account for itself.
        """
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
    """Directory backed store with the same interface, for tests and offline runs.

    Signed URLs are ``file://`` URIs; they carry no expiry because there is
    nothing to sign locally.
    """

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
        if not src.is_file():
            return None
        return json.loads(src.read_text())

    def signed_url(self, key: str) -> str:
        return (self.root / key).resolve().as_uri()
