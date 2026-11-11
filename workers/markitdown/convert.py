"""
Isolated MarkItDown conversion.

Each conversion runs in a child process forked from a forkserver that has
MarkItDown's converters preloaded, so a child starts in milliseconds but shares
nothing mutable with the web server. Inside the child, before any converter
runs:

  * sockets are disabled (``socket.socket`` and DNS resolution raise), so a
    document can never make the worker fetch a URL, whatever a converter does;
  * the address space is capped (RLIMIT_AS) and CPU time is capped
    (RLIMIT_CPU), a second wall behind the zip-bomb guard in policy.py;
  * only the one converter for the already-validated format is called, through
    its ``convert`` method on an in-memory stream: no plugins, no magika
    sniffing, no URI handling, the narrowest entry point MarkItDown offers.

The parent waits ``timeout`` seconds and kills the child if it is still
running. Nothing touches the filesystem.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import re

DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("CONVERT_TIMEOUT_SECONDS", "45"))
CHILD_MEMORY_BYTES = int(os.environ.get("CONVERT_MEMORY_BYTES", str(3 * 1024 * 1024 * 1024)))
MAX_MARKDOWN_CHARS = 2_000_000

_CTX = mp.get_context("forkserver")
_CTX.set_forkserver_preload(["markitdown", "markitdown.converters", "convert"])


class ConversionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _disable_network() -> None:
    import socket

    def refuse(*_args, **_kwargs):
        raise OSError("network access is disabled during document conversion")

    class NoSocket(socket.socket):
        def __init__(self, *args, **kwargs):
            refuse()

    socket.socket = NoSocket  # type: ignore[misc]
    socket.create_connection = refuse  # type: ignore[assignment]
    socket.getaddrinfo = refuse  # type: ignore[assignment]
    socket.gethostbyname = refuse  # type: ignore[assignment]


def _apply_limits(timeout: float) -> None:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (CHILD_MEMORY_BYTES, CHILD_MEMORY_BYTES))
    cpu = int(timeout) + 5
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))


def _converter_for(kind: str):
    from markitdown.converters import (
        DocxConverter,
        OutlookMsgConverter,
        PdfConverter,
        PptxConverter,
        XlsxConverter,
    )

    return {
        "docx": DocxConverter,
        "pptx": PptxConverter,
        "xlsx": XlsxConverter,
        "pdf": PdfConverter,
        "msg": OutlookMsgConverter,
    }[kind]()


_MIMES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
    "msg": "application/vnd.ms-outlook",
}


def _ooxml_title(data: bytes) -> str | None:
    import io
    import zipfile
    from xml.etree import ElementTree

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if "docProps/core.xml" not in zf.namelist():
                return None
            info = zf.getinfo("docProps/core.xml")
            if info.file_size > 1024 * 1024:
                return None
            root = ElementTree.fromstring(zf.read(info))
    except Exception:
        return None
    node = root.find("{http://purl.org/dc/elements/1.1/}title")
    return (node.text or "").strip() or None if node is not None else None


def _pdf_meta(data: bytes) -> tuple[str | None, int | None]:
    import io

    from pdfminer.pdfdocument import PDFDocument
    from pdfminer.pdfpage import PDFPage
    from pdfminer.pdfparser import PDFParser

    try:
        doc = PDFDocument(PDFParser(io.BytesIO(data)))
        pages = sum(1 for _ in PDFPage.create_pages(doc))
        title = None
        for info in doc.info or []:
            raw = info.get("Title")
            if hasattr(raw, "resolve"):
                raw = raw.resolve()
            if isinstance(raw, bytes):
                if raw.startswith(b"\xfe\xff"):
                    title = raw[2:].decode("utf-16-be", "ignore")
                else:
                    title = raw.decode("latin-1", "ignore")
            elif isinstance(raw, str):
                title = raw
            if title:
                break
        return (title.strip() or None) if title else None, pages
    except Exception:
        return None, None


def _first_heading(markdown: str) -> str | None:
    m = re.search(r"^#{1,3}\s+(.+)$", markdown, re.M)
    return m.group(1).strip() if m else None


def describe(kind: str, data: bytes, markdown: str, converter_title: str | None) -> dict:
    """Metadata the ingestion API stores next to the document."""
    meta: dict = {"kind": kind, "chars": len(markdown), "words": len(re.findall(r"\S+", markdown))}
    title = converter_title
    if kind in ("docx", "pptx", "xlsx"):
        title = _ooxml_title(data) or title
    if kind == "pptx":
        meta["slides"] = len(re.findall(r"<!-- Slide number: \d+ -->", markdown))
    elif kind == "xlsx":
        meta["sheets"] = len(re.findall(r"^## .+$", markdown, re.M))
    elif kind == "pdf":
        pdf_title, pages = _pdf_meta(data)
        title = pdf_title or title
        meta["pages"] = pages
    elif kind == "msg":
        m = re.search(r"^\*\*Subject:\*\* (.+)$", markdown, re.M)
        title = (m.group(1).strip() if m else None) or title
    if not title and kind != "msg":
        title = _first_heading(markdown)
    meta["title"] = title
    return meta


def _child(conn, kind: str, data: bytes, timeout: float) -> None:
    try:
        _apply_limits(timeout)
        _disable_network()
        import io

        from markitdown import StreamInfo

        converter = _converter_for(kind)
        info = StreamInfo(extension="." + kind, mimetype=_MIMES[kind])
        result = converter.convert(io.BytesIO(data), info)
        markdown = (result.markdown or "").strip()
        truncated = len(markdown) > MAX_MARKDOWN_CHARS
        if truncated:
            markdown = markdown[:MAX_MARKDOWN_CHARS]
        meta = describe(kind, data, markdown, getattr(result, "title", None))
        meta["truncated"] = truncated
        conn.send(("ok", markdown, meta))
    except MemoryError:
        conn.send(("error", "too_complex", "The document needs more memory to convert than the limit allows."))
    except BaseException as exc:  # report every failure to the parent, never hang it
        conn.send(("error", "conversion_failed", f"{type(exc).__name__}: {exc}"[:500]))
    finally:
        conn.close()


def convert_document(kind: str, data: bytes, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> tuple[str, dict]:
    parent, child = _CTX.Pipe(duplex=False)
    proc = _CTX.Process(target=_child, args=(child, kind, data, timeout), daemon=True)
    proc.start()
    child.close()
    try:
        if not parent.poll(timeout):
            raise ConversionError(
                422, "conversion_timeout", f"Conversion took longer than {int(timeout)} seconds and was stopped."
            )
        try:
            msg = parent.recv()
        except EOFError:
            raise ConversionError(
                422, "conversion_crashed", "The converter stopped before finishing (the file may be too complex)."
            ) from None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(5)
        parent.close()

    if msg[0] == "ok":
        return msg[1], msg[2]
    _, code, message = msg
    raise ConversionError(422, code, message)
