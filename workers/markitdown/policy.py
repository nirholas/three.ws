"""
Request policy for the MarkItDown worker.

Every upload passes ``validate_upload`` before any converter sees a byte. The
file's real type is decided from its content (magic number plus the structure
each format must have), and the file name's extension and the declared MIME
type must both agree with it. OOXML packages are zip archives, so they also
pass ``check_ooxml_archive``: a cap on entries, on total declared uncompressed
size and on per-entry compression ratio, plus a refusal of nested archives,
encrypted entries and path-traversal names.

Python's zipfile never inflates an entry past the size its central directory
declares, so capping the declared sizes here bounds what the converters can
ever decompress. The conversion child also runs under an address-space limit
(see convert.py) as a second wall.

Stdlib only, apart from olefile for the Outlook check, which the outlook extra
already installs.
"""

from __future__ import annotations

import io
import posixpath
import zipfile
from dataclasses import dataclass

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

OOXML_MAX_ENTRIES = 5000
OOXML_MAX_TOTAL_BYTES = 300 * 1024 * 1024
# A deflated XML part compresses 10 to 30 times; media is mostly already
# compressed. 100x on an entry bigger than 1 MiB is a bomb, not a document.
OOXML_MAX_RATIO = 100
OOXML_RATIO_FLOOR_BYTES = 1024 * 1024

GENERIC_MIMES = {"", "application/octet-stream", "binary/octet-stream", "application/x-binary"}


@dataclass(frozen=True)
class Kind:
    name: str
    extension: str
    mimes: frozenset
    label: str


KINDS = {
    "docx": Kind(
        "docx",
        ".docx",
        frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
        "Word document",
    ),
    "pptx": Kind(
        "pptx",
        ".pptx",
        frozenset({"application/vnd.openxmlformats-officedocument.presentationml.presentation"}),
        "PowerPoint presentation",
    ),
    "xlsx": Kind(
        "xlsx",
        ".xlsx",
        frozenset({"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
        "Excel workbook",
    ),
    "pdf": Kind("pdf", ".pdf", frozenset({"application/pdf", "application/x-pdf"}), "PDF"),
    "msg": Kind(
        "msg",
        ".msg",
        frozenset({"application/vnd.ms-outlook", "application/x-ole-storage"}),
        "Outlook message",
    ),
}

BY_EXTENSION = {k.extension: k for k in KINDS.values()}

# The part each OOXML flavour must contain.
OOXML_MAIN_PART = {
    "docx": "word/document.xml",
    "pptx": "ppt/presentation.xml",
    "xlsx": "xl/workbook.xml",
}

ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
PDF_MAGIC = b"%PDF-"


class PolicyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Upload:
    kind: str
    extension: str
    label: str
    archive: dict | None


def _extension(filename: str) -> str:
    base = posixpath.basename((filename or "").replace("\\", "/")).strip()
    dot = base.rfind(".")
    return base[dot:].lower() if dot > 0 else ""


def _normalise_mime(mime: str) -> str:
    return (mime or "").split(";", 1)[0].strip().lower()


def check_ooxml_archive(
    data: bytes,
    *,
    max_entries: int = OOXML_MAX_ENTRIES,
    max_total_bytes: int = OOXML_MAX_TOTAL_BYTES,
    max_ratio: int = OOXML_MAX_RATIO,
) -> dict:
    """Refuse zip bombs and malformed packages. Returns the archive's shape."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, OSError) as exc:
        raise PolicyError(400, "invalid_file", f"The file is not a readable Office package ({exc}).") from None

    if len(infos) > max_entries:
        raise PolicyError(
            400, "zip_bomb", f"The package holds {len(infos)} parts; the limit is {max_entries}."
        )

    total = 0
    for info in infos:
        name = info.filename
        norm = posixpath.normpath(name)
        if name.startswith("/") or norm.startswith("..") or "\\" in name or "\x00" in name:
            raise PolicyError(400, "invalid_file", "The package contains an unsafe part name.")
        if info.flag_bits & 0x1:
            raise PolicyError(400, "invalid_file", "Encrypted or password-protected files cannot be read.")
        if name.lower().endswith((".zip", ".jar", ".7z", ".gz", ".rar")):
            raise PolicyError(400, "zip_bomb", "Nested archives inside an Office file are not accepted.")
        total += info.file_size
        if total > max_total_bytes:
            raise PolicyError(
                400,
                "zip_bomb",
                f"The package expands past {max_total_bytes // (1024 * 1024)} MiB when unpacked.",
            )
        if info.file_size > OOXML_RATIO_FLOOR_BYTES:
            ratio = info.file_size / max(1, info.compress_size)
            if ratio > max_ratio:
                raise PolicyError(
                    400,
                    "zip_bomb",
                    f"A part of this package compresses {int(ratio)}x, far beyond any real document.",
                )
    return {"entries": len(infos), "uncompressed_bytes": total, "names": {i.filename for i in infos}}


def _ooxml_kind(names: set) -> str | None:
    if "[Content_Types].xml" not in names:
        return None
    for kind, part in OOXML_MAIN_PART.items():
        if part in names:
            return kind
    return None


def _is_outlook_message(data: bytes) -> bool:
    import olefile

    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
    except Exception:
        return False
    try:
        return ole.exists("__properties_version1.0") and any(
            entry and entry[0].startswith("__substg1.0_") for entry in ole.listdir()
        )
    finally:
        ole.close()


def validate_upload(data: bytes, filename: str, declared_mime: str) -> Upload:
    if not data:
        raise PolicyError(400, "empty_file", "The file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise PolicyError(
            413, "file_too_large", f"Files can be up to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )

    ext = _extension(filename)
    claimed = BY_EXTENSION.get(ext)
    if not claimed:
        raise PolicyError(
            415,
            "unsupported_type",
            "Supported files are .docx, .pptx, .xlsx, .pdf and .msg.",
        )

    mime = _normalise_mime(declared_mime)
    if mime not in GENERIC_MIMES and mime not in claimed.mimes:
        raise PolicyError(
            415, "type_mismatch", f"The file is named {ext} but was sent as {mime}."
        )

    archive = None
    if data.startswith(ZIP_MAGIC):
        archive = check_ooxml_archive(data)
        actual = _ooxml_kind(archive["names"])
    elif data.startswith(OLE_MAGIC):
        actual = "msg" if _is_outlook_message(data) else None
    elif PDF_MAGIC in data[:1024]:
        actual = "pdf"
    else:
        actual = None

    if actual != claimed.name:
        found = KINDS[actual].label if actual else "an unrecognised format"
        raise PolicyError(
            415,
            "type_mismatch",
            f"The file is named {ext} but its contents are {found}.",
        )

    if archive is not None:
        archive = {k: v for k, v in archive.items() if k != "names"}
    return Upload(kind=claimed.name, extension=ext, label=claimed.label, archive=archive)
