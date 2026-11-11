"""
three.ws MarkItDown worker: Office files and PDFs to Markdown for agent knowledge.

  POST /convert
      Authorization: Bearer <API_KEY>
      X-File-Name:   <url-encoded original file name>   (decides the claimed type)
      Content-Type:  the file's MIME type (or application/octet-stream)
      body:          the raw file bytes
    200 { markdown, metadata: { kind, title, slides|sheets|pages, words, chars, truncated },
          file: { name, kind, bytes, sha256 } }
    4xx { error, message } for policy and conversion failures (see policy.py)

  GET /health  ->  { ok, markitdown, formats }

Env:
  API_KEY                   shared bearer secret (required; the API sends GCP_RECONSTRUCTION_KEY)
  MAX_CONCURRENT            conversions running at once (default 2)
  CONVERT_TIMEOUT_SECONDS   per-request conversion limit (default 45)
  CONVERT_MEMORY_BYTES      address-space cap for each conversion child (default 3 GiB)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from importlib.metadata import version
from typing import Optional
from urllib.parse import unquote

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from convert import ConversionError, convert_document
from policy import KINDS, MAX_UPLOAD_BYTES, PolicyError, validate_upload
from worker_security import require_api_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("markitdown-worker")

API_KEY = os.environ["API_KEY"]
MAX_CONCURRENT = max(1, int(os.environ.get("MAX_CONCURRENT", "2")))
MARKITDOWN_VERSION = version("markitdown")

app = FastAPI(title="three.ws markitdown worker", docs_url=None, redoc_url=None, openapi_url=None)
_slots = asyncio.Semaphore(MAX_CONCURRENT)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


async def _read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise PolicyError(413, "file_too_large", f"Files can be up to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > MAX_UPLOAD_BYTES:
            raise PolicyError(413, "file_too_large", f"Files can be up to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    return bytes(buf)


@app.post("/convert")
async def convert(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_file_name: Optional[str] = Header(default=None),
    content_type: Optional[str] = Header(default=None),
):
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError:
        return _error(401, "unauthorized", "missing or invalid bearer token")

    name = unquote(x_file_name or "").strip()[:255]
    if not name:
        return _error(400, "missing_file_name", "Send the original file name in the X-File-Name header.")

    try:
        data = await _read_capped(request)
        upload = validate_upload(data, name, content_type or "")
    except PolicyError as exc:
        log.info("rejected %s: %s", exc.code, exc.message)
        return _error(exc.status, exc.code, exc.message)

    digest = hashlib.sha256(data).hexdigest()
    async with _slots:
        try:
            markdown, meta = await asyncio.to_thread(convert_document, upload.kind, data)
        except ConversionError as exc:
            log.warning("conversion failed kind=%s sha=%s code=%s %s", upload.kind, digest[:12], exc.code, exc.message)
            return _error(exc.status, exc.code, exc.message)

    if not markdown.strip():
        return _error(422, "no_text", f"No readable text was found in this {upload.label}.")

    log.info("converted kind=%s bytes=%d chars=%d sha=%s", upload.kind, len(data), len(markdown), digest[:12])
    return {
        "markdown": markdown,
        "metadata": meta,
        "file": {"name": name, "kind": upload.kind, "bytes": len(data), "sha256": digest},
    }


@app.get("/health")
async def health():
    return {"ok": True, "markitdown": MARKITDOWN_VERSION, "formats": sorted(k.extension for k in KINDS.values())}
