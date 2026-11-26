"""three.ws 360 capture client: multipart upload plus the pano-capture and pano-scene jobs.

Stdlib only (``urllib``, ``concurrent.futures``) because a Blender extension cannot
rely on pip. It talks to the capture API of a three.ws deployment:

* ``POST /api/capture-upload/{create,sign,complete,abort}``  multipart upload to R2
* ``POST /api/pano-capture``                 a 360 video, raw ``.insv`` or photo set to a splat
* ``GET  /api/pano-capture?job=<id>``        poll, ``?mine=1`` list, ``DELETE ?job=<id>`` cancel
* ``POST /api/pano-scene``                   one equirect photo (or raw ``.insp``) to a depth shell GLB
* ``GET  /api/pano-scene?job=<id>``          poll

It subclasses the vendored Forge client for headers, the API key and error mapping,
so a key set once works for both. This module is intentionally not vendored: only
the Blender extension uses it.

Nothing here imports ``bpy``. Every network call first runs ``online_guard`` (the
extension passes a function that reports why ``bpy.app.online_access`` is off), so no
request leaves the machine while Blender forbids it.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Callable, Optional

from .three_ws_client import ThreeWSClient, ThreeWSError, _urlopen

PARALLEL_PARTS = 4
PART_ATTEMPTS = 4
SIGN_BATCH = 100
POLL_INTERVAL = 3.0
POLL_TIMEOUT = 4 * 3600.0
MAX_BYTES = 8 * 1024 ** 3

SUCCESS_STATES = frozenset({"succeeded", "completed", "complete", "done", "ready"})
FAILURE_STATES = frozenset({"failed", "error"})
CANCELLED_STATES = frozenset({"cancelled", "canceled"})

QUALITIES = ("preview", "standard", "high")

_CONTENT_TYPES = {
    "insv": "application/octet-stream",
    "insp": "application/octet-stream",
    "lrv": "application/octet-stream",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "exr": "image/x-exr",
}
VIDEO_EXTS = frozenset({"mp4", "mov"})
IMAGE_EXTS = frozenset({"jpg", "jpeg", "png", "exr"})
RAW_EXTS = frozenset({"insv", "insp", "lrv"})


class Cancelled(Exception):
    """The user cancelled the operation."""


class _Stopped(Exception):
    """A part stopped early because another part failed; the failure is what gets raised."""


def file_ext(path: str) -> str:
    return path.rsplit(".", 1)[-1].lower() if "." in os.path.basename(path) else ""


def capture_content_type(path: str) -> str:
    ext = file_ext(path)
    ct = _CONTENT_TYPES.get(ext)
    if not ct:
        raise ThreeWSError(
            f"Unsupported file type '.{ext}'. Use .insv, .insp, a 2:1 mp4 or mov, "
            "or a 2:1 jpg, png or exr.",
            code="invalid_content_type",
        )
    return ct


def source_kind_for(path: str) -> str:
    """The ``source_kind`` three.ws expects for a single file."""
    ext = file_ext(path)
    if ext in ("insv", "lrv"):
        return "insv"
    if ext == "insp":
        return "insp"
    if ext in VIDEO_EXTS:
        return "equirect_video"
    if ext in IMAGE_EXTS:
        return "equirect_image"
    raise ThreeWSError(f"Unsupported file type '.{ext}'.", code="invalid_content_type")


def lane_for(path: str) -> str:
    """``splat`` for footage (video or raw .insv), ``shell`` for a single photo."""
    return "shell" if file_ext(path) in ("insp",) or file_ext(path) in IMAGE_EXTS else "splat"


def is_success(status) -> bool:
    return str(status or "").lower() in SUCCESS_STATES


def is_failure(status) -> bool:
    return str(status or "").lower() in FAILURE_STATES


def is_cancelled(status) -> bool:
    return str(status or "").lower() in CANCELLED_STATES


def is_terminal(status) -> bool:
    return is_success(status) or is_failure(status) or is_cancelled(status)


class Capture360Client(ThreeWSClient):
    """Upload a 360 file and drive the capture jobs.

    Parameters
    ----------
    online_guard
        Called before every network request. Return a string to refuse (the string is
        the user-facing reason) or ``None`` to allow.
    state_dir
        Directory for resume files. An interrupted upload picks up at the first
        missing part the next time the same file is sent.
    """

    def __init__(
        self,
        base_url: str = "https://three.ws",
        *,
        online_guard: Optional[Callable[[], Optional[str]]] = None,
        state_dir: Optional[str] = None,
        parallel: int = PARALLEL_PARTS,
        part_attempts: int = PART_ATTEMPTS,
        retry_delay: float = 1.0,
        **kwargs,
    ):
        super().__init__(base_url, **kwargs)
        self.online_guard = online_guard
        self.state_dir = state_dir
        self.parallel = max(1, int(parallel))
        self.part_attempts = max(1, int(part_attempts))
        self.retry_delay = retry_delay

    # -- network gate -----------------------------------------------------------

    def _check_online(self) -> None:
        if self.online_guard:
            reason = self.online_guard()
            if reason:
                raise ThreeWSError(reason, code="offline")

    def _request(self, method, path, **kwargs):
        self._check_online()
        try:
            return super()._request(method, path, **kwargs)
        except ThreeWSError as exc:
            if exc.status == 404 and "No API route matches" in exc.message:
                raise ThreeWSError(
                    f"{self.base_url} does not offer 360 capture yet. Point the add-on's API URL "
                    "at a deployment that does, or try again after it is updated.",
                    code="capture_unavailable",
                    status=404,
                ) from exc
            raise

    def download(self, url: str, dest_path: str, *, progress=None, should_cancel=None) -> str:
        """Stream ``url`` to ``dest_path`` with progress and cancel support."""
        self._check_online()
        req = urllib.request.Request(url, headers={"user-agent": "three-ws-plugin/1.0"})
        tmp_path = dest_path + ".part"
        try:
            with _urlopen(req, max(self.timeout, 120)) as resp, open(tmp_path, "wb") as out:
                total = int(resp.headers.get("content-length") or 0)
                done = 0
                while True:
                    if should_cancel and should_cancel():
                        raise Cancelled()
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if progress and total:
                        progress(done / total)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
            _remove(tmp_path)
            raise ThreeWSError(f"Download failed: {exc}", code="download_failed") from exc
        except Cancelled:
            _remove(tmp_path)
            raise
        os.replace(tmp_path, dest_path)
        return dest_path

    # -- resume state -----------------------------------------------------------

    def _state_path(self, path: str, size: int, mtime_ns: int) -> Optional[str]:
        if not self.state_dir:
            return None
        ident = f"{self.base_url}|{os.path.abspath(path)}|{size}|{mtime_ns}"
        digest = hashlib.sha1(ident.encode("utf-8")).hexdigest()[:20]
        return os.path.join(self.state_dir, "uploads", f"{digest}.json")

    @staticmethod
    def _load_state(state_path: Optional[str]) -> Optional[dict]:
        if not state_path or not os.path.isfile(state_path):
            return None
        try:
            with open(state_path, "r", encoding="utf-8") as fh:
                state = json.load(fh)
        except (OSError, ValueError):
            return None
        return state if isinstance(state, dict) else None

    @staticmethod
    def _save_state(state_path: Optional[str], state: dict) -> None:
        if not state_path:
            return
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, state_path)

    # -- multipart upload -------------------------------------------------------

    def create_upload(self, filename: str, content_type: str, size_bytes: int) -> dict:
        return self._request(
            "POST",
            "/api/capture-upload/create",
            body={
                "filename": filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "kind": "pano",
            },
        )

    def sign_parts(self, upload_id: str, key: str, part_numbers: list) -> dict:
        urls: dict = {}
        for start in range(0, len(part_numbers), SIGN_BATCH):
            batch = part_numbers[start:start + SIGN_BATCH]
            res = self._request(
                "POST",
                "/api/capture-upload/sign",
                body={"upload_id": upload_id, "key": key, "part_numbers": batch},
            )
            urls.update({str(k): v for k, v in (res.get("urls") or {}).items()})
        return urls

    def complete_upload(self, upload_id: str, key: str, parts: dict) -> dict:
        ordered = [
            {"part_number": int(n), "etag": parts[n]} for n in sorted(parts, key=int)
        ]
        return self._request(
            "POST",
            "/api/capture-upload/complete",
            body={"upload_id": upload_id, "key": key, "parts": ordered},
        )

    def abort_upload(self, upload_id: str, key: str) -> None:
        self._request("POST", "/api/capture-upload/abort", body={"upload_id": upload_id, "key": key})

    def _put_part(self, url: str, data: bytes) -> str:
        """PUT one part to its presigned URL and return the ETag R2 answers with."""
        self._check_online()
        req = urllib.request.Request(
            url,
            data=data,
            method="PUT",
            headers={"content-length": str(len(data)), "user-agent": "three-ws-plugin/1.0"},
        )
        with _urlopen(req, max(self.timeout, 300)) as resp:
            etag = resp.headers.get("ETag") or resp.headers.get("etag")
            resp.read()
        if not etag:
            raise ThreeWSError("The storage server did not return an ETag for a part.", code="missing_etag")
        return etag

    def upload_file(
        self,
        path: str,
        *,
        progress: Optional[Callable[[float, int, int], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
    ) -> dict:
        """Upload ``path`` in parallel parts and return ``{source_url, size_bytes}``.

        ``progress(fraction, parts_done, parts_total)`` is called from worker threads
        as parts finish. A cancel aborts the multipart upload and drops the resume file.
        """
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            raise ThreeWSError(f"File not found: {path}", code="file_not_found")
        stat = os.stat(path)
        size = stat.st_size
        if size <= 0:
            raise ThreeWSError("That file is empty.", code="empty_file")
        if size > MAX_BYTES:
            raise ThreeWSError("Files over 8 GiB are not accepted.", code="too_large")
        content_type = capture_content_type(path)
        state_path = self._state_path(path, size, stat.st_mtime_ns)

        state = self._load_state(state_path)
        if state and not (state.get("upload_id") and state.get("key") and state.get("part_size")):
            state = None
        if state is None:
            created = self.create_upload(os.path.basename(path), content_type, size)
            state = {
                "upload_id": created["upload_id"],
                "key": created["key"],
                "part_size": int(created["part_size"]),
                "part_count": int(created["part_count"]),
                "parts": {},
            }
            self._save_state(state_path, state)

        try:
            self._upload_parts(path, size, state, state_path, progress, should_cancel)
        except Cancelled:
            try:
                self.abort_upload(state["upload_id"], state["key"])
            except ThreeWSError:
                pass
            _remove(state_path)
            raise
        except ThreeWSError as exc:
            if exc.status in (404, 410) and exc.code in ("upload_not_found", "not_found", "expired", "no_such_upload"):
                _remove(state_path)
            raise

        done = self.complete_upload(state["upload_id"], state["key"], state["parts"])
        _remove(state_path)
        return {"source_url": done["source_url"], "size_bytes": done.get("size_bytes", size)}

    def _upload_parts(self, path, size, state, state_path, progress, should_cancel):
        part_size = state["part_size"]
        part_count = state["part_count"]
        parts = {int(k): v for k, v in state["parts"].items()}
        state["parts"] = {str(k): v for k, v in parts.items()}
        missing = [n for n in range(1, part_count + 1) if n not in parts]
        lock = threading.Lock()
        stop = threading.Event()
        done_bytes = [sum(_part_len(n, part_size, size) for n in parts)]

        def report():
            if progress:
                progress(min(1.0, done_bytes[0] / size), len(parts), part_count)

        report()
        if not missing:
            return

        urls = self.sign_parts(state["upload_id"], state["key"], missing)

        def send(number: int) -> str:
            try:
                return send_part(number)
            except BaseException:
                stop.set()
                raise

        def send_part(number: int) -> str:
            offset = (number - 1) * part_size
            length = _part_len(number, part_size, size)
            with open(path, "rb") as fh:
                fh.seek(offset)
                data = fh.read(length)
            if len(data) != length:
                raise ThreeWSError("The file changed while it was uploading. Send it again.", code="file_changed")
            last: Optional[Exception] = None
            for attempt in range(self.part_attempts):
                if stop.is_set():
                    raise _Stopped()
                if should_cancel and should_cancel():
                    raise Cancelled()
                try:
                    return self._put_part(urls[str(number)], data)
                except urllib.error.HTTPError as exc:
                    last = exc
                    if exc.code == 403:
                        fresh = self.sign_parts(state["upload_id"], state["key"], [number])
                        urls[str(number)] = fresh[str(number)]
                    elif exc.code < 500 and exc.code != 429:
                        raise ThreeWSError(
                            f"Storage refused part {number} (HTTP {exc.code}).", code="part_refused", status=exc.code
                        ) from exc
                except (urllib.error.URLError, OSError, ThreeWSError) as exc:
                    if isinstance(exc, ThreeWSError) and exc.code in ("offline", "missing_etag"):
                        raise
                    last = exc
                if attempt + 1 < self.part_attempts:
                    time.sleep(self.retry_delay * (2 ** attempt))
            raise ThreeWSError(
                f"Part {number} failed after {self.part_attempts} attempts: {last}. "
                "Send the same file again to resume where it stopped.",
                code="part_failed",
            )

        # Every future is drained before raising, so the error raised is the part that
        # actually failed (or the user's Cancelled), never a sibling's early _Stopped.
        failure: Optional[BaseException] = None
        with ThreadPoolExecutor(max_workers=self.parallel, thread_name_prefix="threews-part") as pool:
            pending = {pool.submit(send, n): n for n in missing}
            try:
                while pending:
                    finished, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for fut in finished:
                        number = pending.pop(fut)
                        if fut.cancelled():
                            continue
                        exc = fut.exception()
                        if exc is not None:
                            if failure is None and not isinstance(exc, _Stopped):
                                failure = exc
                            stop.set()
                            for other in pending:
                                other.cancel()
                            continue
                        etag = fut.result()
                        with lock:
                            parts[number] = etag
                            state["parts"][str(number)] = etag
                            done_bytes[0] += _part_len(number, part_size, size)
                            self._save_state(state_path, state)
                        report()
            except BaseException:
                stop.set()
                for fut in pending:
                    fut.cancel()
                raise
        if failure is not None:
            raise failure

    # -- pano-capture (splat) ---------------------------------------------------

    def create_capture(
        self,
        source_url: str,
        source_kind: str,
        *,
        source_urls: Optional[list] = None,
        trim: Optional[dict] = None,
        quality: str = "standard",
    ) -> dict:
        body: dict = {"source_url": source_url, "source_kind": source_kind, "quality": quality}
        if source_urls:
            body["source_urls"] = source_urls
        if trim:
            body["trim"] = trim
        return self._request("POST", "/api/pano-capture", body=body)

    def get_capture(self, job_id: str) -> dict:
        return self._request("GET", "/api/pano-capture?job=" + urllib.parse.quote(job_id, safe=""))

    def list_captures(self) -> list:
        return list(self._request("GET", "/api/pano-capture?mine=1").get("captures") or [])

    def cancel_capture(self, job_id: str) -> dict:
        return self._request("DELETE", "/api/pano-capture?job=" + urllib.parse.quote(job_id, safe=""))

    # -- pano-scene (depth shell) -----------------------------------------------

    def create_scene(self, image_url: str, source_kind: str) -> dict:
        return self._request(
            "POST", "/api/pano-scene", body={"image_url": image_url, "source_kind": source_kind}
        )

    def get_scene(self, job_id: str) -> dict:
        return self._request("GET", "/api/pano-scene?job=" + urllib.parse.quote(job_id, safe=""))

    # -- polling ----------------------------------------------------------------

    def wait_for_job(
        self,
        fetch: Callable[[], dict],
        *,
        on_update: Optional[Callable[[dict], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        interval: float = POLL_INTERVAL,
        timeout: float = POLL_TIMEOUT,
    ) -> dict:
        """Poll ``fetch`` until the job is terminal and return the final body.

        Raises ``ThreeWSError`` for a failed job (with the server's visitor-readable
        message) and ``Cancelled`` when ``should_cancel`` turns true or the job was
        cancelled elsewhere.
        """
        deadline = time.monotonic() + timeout
        transient = 0
        while True:
            if should_cancel and should_cancel():
                raise Cancelled()
            try:
                body = fetch()
                transient = 0
            except ThreeWSError as exc:
                transient += 1
                if exc.code != "unreachable" or transient > 5:
                    raise
                body = None
            if body is not None:
                if on_update:
                    on_update(body)
                status = body.get("status")
                if is_success(status):
                    return body
                if is_failure(status):
                    err = body.get("error") or {}
                    if isinstance(err, str):
                        err = {"message": err}
                    raise ThreeWSError(
                        err.get("message") or "three.ws could not finish this capture.",
                        code=err.get("code") or "job_failed",
                    )
                if is_cancelled(status):
                    raise Cancelled()
            if time.monotonic() > deadline:
                raise ThreeWSError("The capture is taking too long. Check it again later.", code="timeout")
            end = time.monotonic() + interval
            while time.monotonic() < end:
                if should_cancel and should_cancel():
                    raise Cancelled()
                time.sleep(min(0.1, interval))


def _part_len(number: int, part_size: int, size: int) -> int:
    start = (number - 1) * part_size
    return max(0, min(part_size, size - start))


def _remove(path: Optional[str]) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass
