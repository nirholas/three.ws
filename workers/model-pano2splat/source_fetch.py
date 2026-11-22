"""SSRF-safe streaming download of caller sources to local disk.

``worker_security.fetch_remote_bytes`` buffers in memory, which is fine for
images and impossible for an 8 GiB 360 video, so this module streams to disk
with the same guarantees: https only, every hop (including redirects) resolved
and rejected if it maps to a private, loopback, link-local or metadata address,
and a running byte cap shared across every file of one task.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

from worker_security import UnsafeUrlError, assert_safe_url

MAX_SOURCE_BYTES = int(os.environ.get("MAX_SOURCE_BYTES", str(8 * 1024 * 1024 * 1024)))
MAX_REDIRECTS = 5
CHUNK = 1024 * 1024
ATTEMPTS = 3


class SourceError(Exception):
    """A source could not be fetched or is not the kind of file the caller named."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ByteBudget:
    """Running cap on bytes downloaded across all sources of one task."""

    def __init__(self, limit: int = MAX_SOURCE_BYTES):
        self.limit = limit
        self.used = 0

    def take(self, n: int) -> None:
        self.used += n
        if self.used > self.limit:
            raise SourceError(
                "source_too_large",
                f"The source files are larger than the {self.limit // (1024 ** 3)} GiB limit.",
            )


def sniff(head: bytes, source_kind: str) -> Optional[str]:
    """File extension if ``head`` is acceptable for ``source_kind``, else None."""
    is_jpeg = head[:3] == b"\xff\xd8\xff"
    is_png = head[:8] == b"\x89PNG\r\n\x1a\n"
    is_iso_bmff = len(head) >= 12 and head[4:8] == b"ftyp"
    is_matroska = head[:4] == b"\x1aE\xdf\xa3"
    if source_kind == "equirect_images":
        return ".jpg" if is_jpeg else ".png" if is_png else None
    if source_kind == "insp":
        return ".insp" if is_jpeg else None
    if source_kind == "insv":
        return ".insv" if is_iso_bmff else None
    if source_kind == "equirect_video":
        if is_iso_bmff:
            return ".mp4"
        if is_matroska:
            return ".mkv"
    return None


KIND_LABEL = {
    "equirect_images": "a JPEG or PNG photo",
    "insp": "an Insta360 .insp photo",
    "insv": "an Insta360 .insv video",
    "equirect_video": "an MP4, MOV, WebM or MKV video",
}


def _open_stream(client: httpx.Client, url: str, headers: dict):
    current = assert_safe_url(url)
    for _ in range(MAX_REDIRECTS + 1):
        req = client.build_request("GET", current, headers=headers)
        resp = client.send(req, stream=True)
        if resp.is_redirect:
            location = resp.headers.get("location")
            resp.close()
            if not location:
                raise UnsafeUrlError("redirect without Location header")
            current = assert_safe_url(str(resp.url.join(location)))
            continue
        return resp
    raise UnsafeUrlError(f"too many redirects (>{MAX_REDIRECTS})")


def download_source(
    url: str,
    dest_stem: Path,
    source_kind: str,
    budget: ByteBudget,
    on_bytes: Optional[Callable[[int], None]] = None,
    cancelled: Optional[Callable[[], bool]] = None,
) -> Path:
    """Stream ``url`` to ``dest_stem`` plus a sniffed extension and return the path."""
    last_exc: Optional[Exception] = None
    for attempt in range(ATTEMPTS):
        start_used = budget.used
        try:
            return _download_once(url, dest_stem, source_kind, budget, on_bytes, cancelled)
        except SourceError:
            raise
        except UnsafeUrlError as exc:
            raise SourceError("unsafe_source_url", f"That source address is not allowed: {exc}.") from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status not in (429, 500, 502, 503, 504):
                raise SourceError(
                    "source_unreachable",
                    f"The source file could not be fetched: its host answered {_status_text(exc.response)}. {UPLOAD_HINT}",
                ) from exc
            last_exc = exc
        except httpx.TransportError as exc:
            last_exc = exc
        budget.used = start_used
        time.sleep(2.0 * (attempt + 1))
    if isinstance(last_exc, httpx.HTTPStatusError):
        why = f"its host kept answering {_status_text(last_exc.response)}"
    else:
        why = f"its host could not be reached ({type(last_exc).__name__})"
    raise SourceError(
        "source_unreachable",
        f"The source file could not be fetched after {ATTEMPTS} attempts: {why}. {UPLOAD_HINT}",
    )


# Some hosts refuse cloud egress outright (upload.wikimedia.org answers Cloud
# Run with 429 while serving the same file to anyone else, measured
# 2026-11-22), so the way out is to hand over the file instead of a link.
UPLOAD_HINT = "Some hosts refuse downloads from cloud servers; upload the file itself instead of linking to it."


def _status_text(resp: httpx.Response) -> str:
    phrase = (resp.reason_phrase or "").split(".")[0].strip()
    return f"HTTP {resp.status_code} {phrase}".strip()


def _download_once(url, dest_stem, source_kind, budget, on_bytes, cancelled) -> Path:
    headers = {"User-Agent": "three-ws-pano2splat/1"}
    timeout = httpx.Timeout(30.0, read=120.0)
    with httpx.Client(follow_redirects=False, timeout=timeout) as client:
        resp = _open_stream(client, url, headers)
        try:
            resp.raise_for_status()
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and budget.used + int(declared) > budget.limit:
                raise SourceError(
                    "source_too_large",
                    f"The source file is {int(declared) // (1024 ** 2)} MiB, over the "
                    f"{budget.limit // (1024 ** 3)} GiB limit.",
                )
            tmp = dest_stem.with_name(dest_stem.name + ".part")
            ext: Optional[str] = None
            pending = bytearray()

            def accept(data: bytes, fh) -> None:
                budget.take(len(data))
                fh.write(data)
                if on_bytes:
                    on_bytes(len(data))

            def decide(head: bytes) -> str:
                found = sniff(head[:16], source_kind)
                if found is None:
                    raise SourceError(
                        "unsupported_input",
                        f"That file is not {KIND_LABEL[source_kind]}, so it cannot be used as this source type.",
                    )
                return found

            try:
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_bytes(CHUNK):
                        if cancelled and cancelled():
                            raise SourceError("cancelled", "The task was cancelled.")
                        if ext is None:
                            pending += chunk
                            if len(pending) < 16:
                                continue
                            ext = decide(bytes(pending))
                            accept(bytes(pending), fh)
                            pending.clear()
                        else:
                            accept(chunk, fh)
                    if ext is None:
                        if not pending:
                            raise SourceError("corrupt_input", "The source file is empty.")
                        ext = decide(bytes(pending))
                        accept(bytes(pending), fh)
                final = dest_stem.with_name(dest_stem.name + ext)
                os.replace(tmp, final)
                return final
            finally:
                if tmp.exists():
                    tmp.unlink()
        finally:
            resp.close()
