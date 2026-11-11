"""
Self-authored sample documents in every format the worker converts.

Used by the build-gate tests (so the image proves it converts a real file of
each kind before it ships) and by ``python fixtures.py <dir>``, which writes the
five files to disk for end-to-end tests of the upload flow. Everything here is
written from scratch: no third-party sample files, nothing copyrighted.

The .docx and .pdf are assembled by hand from their published structure (no
writer library needed); the .pptx and .xlsx use python-pptx and openpyxl, which
the worker already installs for reading; the .msg is a minimal Outlook message
in a Compound File Binary container built by ``make_cfb``.
"""

from __future__ import annotations

import io
import os
import struct
import sys
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

# ── .docx ──────────────────────────────────────────────────────────────────────

DOCX_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '<Override PartName="/docProps/core.xml" '
    'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    "</Types>"
)

_DOCX_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/>'
    '<Relationship Id="rId2" '
    'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
    'Target="docProps/core.xml"/>'
    "</Relationships>"
)

_DOCX_DOC_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
    'Target="styles.xml"/>'
    "</Relationships>"
)

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

_DOCX_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:styles xmlns:w="{_W}">'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>'
    "</w:styles>"
)

DOCX_SECTIONS = [
    ("Heading1", "Northwind Field Handbook"),
    ("Normal", "This handbook is written for new field technicians at the Northwind repair depot."),
    ("Heading2", "Shift hours"),
    ("Normal", "The depot opens at 07:30 and the first shift ends at 16:00. Weekend cover runs on a rota posted every Friday."),
    ("Heading2", "Returns policy"),
    ("Normal", "Customers may return a repaired unit within 45 days for a free second inspection. Bring the blue job card."),
    ("Heading2", "Safety"),
    ("Normal", "Lithium packs above 100 Wh are charged only inside the fireproof cabinet in bay 4."),
]


def _core_xml(title: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties '
        'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{escape(title)}</dc:title>"
        "<dc:creator>three.ws</dc:creator>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        "</cp:coreProperties>"
    )


def make_docx(sections=None, title: str = "Northwind Field Handbook") -> bytes:
    sections = sections or DOCX_SECTIONS
    paras = []
    for style, text in sections:
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style != "Normal" else ""
        paras.append(f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{_W}"><w:body>{"".join(paras)}</w:body></w:document>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", DOCX_CONTENT_TYPES)
        zf.writestr("_rels/.rels", _DOCX_RELS)
        zf.writestr("word/_rels/document.xml.rels", _DOCX_DOC_RELS)
        zf.writestr("word/document.xml", document)
        zf.writestr("word/styles.xml", _DOCX_STYLES)
        zf.writestr("docProps/core.xml", _core_xml(title))
    return buf.getvalue()


# ── .pptx ──────────────────────────────────────────────────────────────────────

PPTX_SLIDES = [
    ("Northwind 2027 roadmap", "Three launches, one per quarter after Q1."),
    ("Q2: Depot app", "Technicians book bays from their phone. Pilot in the Leeds depot."),
    ("Q3: Parts locker", "Self-service parts pickup open 24 hours, badge access only."),
    ("Q4: Warranty portal", "Customers check repair status and warranty end date online."),
]


def make_pptx(slides=None, title: str = "Northwind 2027 roadmap") -> bytes:
    from pptx import Presentation

    prs = Presentation()
    prs.core_properties.title = title
    layout = prs.slide_layouts[1]
    for heading, body in slides or PPTX_SLIDES:
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = heading
        slide.placeholders[1].text = body
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


# ── .xlsx ──────────────────────────────────────────────────────────────────────

XLSX_SHEETS = {
    "Price list": [
        ["SKU", "Item", "Price (EUR)"],
        ["NW-100", "Battery health check", 19],
        ["NW-210", "Screen replacement, 13 inch", 189],
        ["NW-305", "Keyboard deep clean", 35],
    ],
    "Support tiers": [
        ["Tier", "Response time", "Monthly fee (EUR)"],
        ["Basic", "2 business days", 0],
        ["Priority", "4 hours", 49],
    ],
}


def make_xlsx(sheets=None, title: str = "Northwind price sheet") -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    wb.properties.title = title
    for name, rows in (sheets or XLSX_SHEETS).items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── .pdf ───────────────────────────────────────────────────────────────────────

PDF_PAGES = [
    [
        "Northwind Service Level Brief",
        "Priority customers receive an engineer on site within 4 hours,",
        "Monday to Saturday, between 08:00 and 20:00.",
    ],
    [
        "Escalation",
        "Unresolved priority tickets escalate to the depot lead after 24 hours.",
        "The depot lead phone line is staffed until 22:00.",
    ],
]


def _pdf_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages=None, title: str = "Northwind Service Level Brief") -> bytes:
    pages = pages or PDF_PAGES
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_id = len(objects) + 1 + 2 * len(pages)  # reserved below, after page objects
    page_ids = []
    for lines in pages:
        ops = ["BT", "/F1 12 Tf", "16 TL", "72 740 Td"]
        for line in lines:
            ops.append(f"({_pdf_text(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        content_id = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, font_id, content_id)
            )
        )
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    assert add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))) == pages_id
    catalog_id = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    info_id = add(b"<< /Title (%s) /Producer (three.ws fixtures) >>" % _pdf_text(title).encode("latin-1"))

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(
        b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, catalog_id, info_id, xref)
    )
    return out.getvalue()


# ── Compound File Binary (.msg container) ─────────────────────────────────────

_ENDOFCHAIN = 0xFFFFFFFE
_FREESECT = 0xFFFFFFFF
_FATSECT = 0xFFFFFFFD
_NOSTREAM = 0xFFFFFFFF
_SECTOR = 512
_MINI = 64
_CUTOFF = 4096


def _dir_entry(name: str, etype: int, right: int, child: int, start: int, size: int, clsid: bytes = b"\x00" * 16) -> bytes:
    encoded = name.encode("utf-16-le") + b"\x00\x00"
    if len(encoded) > 64:
        raise ValueError(f"CFB entry name too long: {name}")
    return (
        encoded.ljust(64, b"\x00")
        + struct.pack("<HBB", len(encoded), etype, 1)  # length, type, colour=black
        + struct.pack("<III", _NOSTREAM, right, child)
        + clsid
        + struct.pack("<I", 0)
        + b"\x00" * 16  # created, modified
        + struct.pack("<IQ", start, size)
    )


def make_cfb(streams: dict[str, bytes], root_clsid: bytes = b"\x00" * 16) -> bytes:
    """Write a version 3 Compound File with every stream in the root storage.

    Streams must each be smaller than the 4096-byte mini stream cutoff, which
    keeps the layout to: one FAT sector, the directory, the mini FAT and the
    mini stream. That is all an Outlook message of a few kilobytes needs.
    """
    # MS-CFB orders siblings by name length, then by upper-cased name. A chain
    # of right siblings in that order is a valid (if unbalanced) tree.
    names = sorted(streams, key=lambda n: (len(n), n.upper()))
    for n in names:
        if len(streams[n]) >= _CUTOFF:
            raise ValueError(f"stream {n} must be under {_CUTOFF} bytes")

    mini = bytearray()
    minifat: list[int] = []
    starts = {}
    for n in names:
        data = streams[n]
        count = max(1, -(-len(data) // _MINI))
        first = len(minifat)
        starts[n] = first
        minifat.extend(range(first + 1, first + count))
        minifat.append(_ENDOFCHAIN)
        mini += data.ljust(count * _MINI, b"\x00")

    entries_count = 1 + len(names)
    dir_sectors = -(-entries_count * 128 // _SECTOR)
    minifat_sectors = max(1, -(-len(minifat) * 4 // _SECTOR))
    mini_sectors = max(1, -(-len(mini) // _SECTOR))

    fat_start = 0
    dir_start = 1
    minifat_start = dir_start + dir_sectors
    mini_start = minifat_start + minifat_sectors
    total = mini_start + mini_sectors
    if total > _SECTOR // 4:
        raise ValueError("fixture too large for a single FAT sector")

    fat = [_FREESECT] * (_SECTOR // 4)
    fat[fat_start] = _FATSECT

    def chain(start: int, count: int) -> None:
        for i in range(count - 1):
            fat[start + i] = start + i + 1
        fat[start + count - 1] = _ENDOFCHAIN

    chain(dir_start, dir_sectors)
    chain(minifat_start, minifat_sectors)
    chain(mini_start, mini_sectors)

    entries = [
        _dir_entry("Root Entry", 5, _NOSTREAM, 1 if names else _NOSTREAM, mini_start, len(mini), root_clsid)
    ]
    for i, n in enumerate(names, start=1):
        right = i + 1 if i < len(names) else _NOSTREAM
        entries.append(_dir_entry(n, 2, right, _NOSTREAM, starts[n], len(streams[n])))
    directory = b"".join(entries)
    empty_entry = b"\x00" * 64 + struct.pack("<HBB", 0, 0, 0) + struct.pack("<III", _NOSTREAM, _NOSTREAM, _NOSTREAM) + b"\x00" * 48
    assert len(empty_entry) == 128
    while len(directory) < dir_sectors * _SECTOR:
        directory += empty_entry

    header = (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        + b"\x00" * 16
        + struct.pack("<HHHHH", 0x003E, 0x0003, 0xFFFE, 9, 6)
        + b"\x00" * 6
        + struct.pack("<IIII", 0, 1, dir_start, 0)
        + struct.pack("<IIIII", _CUTOFF, minifat_start, minifat_sectors, _ENDOFCHAIN, 0)
        + struct.pack("<I", fat_start)
        + struct.pack("<I", _FREESECT) * 108
    )
    assert len(header) == _SECTOR

    minifat_bytes = struct.pack("<%dI" % len(minifat), *minifat)
    minifat_bytes = minifat_bytes.ljust(minifat_sectors * _SECTOR, b"\xff")
    return (
        header
        + struct.pack("<%dI" % len(fat), *fat)
        + directory
        + minifat_bytes
        + bytes(mini).ljust(mini_sectors * _SECTOR, b"\x00")
    )


# ── .msg ───────────────────────────────────────────────────────────────────────

MSG_FIELDS = {
    "subject": "Holiday opening hours",
    "sender": "depot.lead@northwind.example",
    "to": "all-technicians@northwind.example",
    "body": (
        "Hi all,\n\n"
        "Over the winter holiday the depot closes at 14:00 on 24 December and "
        "stays closed on 25 and 26 December. Normal hours resume on 27 December.\n\n"
        "Thanks,\nDepot lead"
    ),
}

# CLSID {00020D0B-0000-0000-C000-000000000046}: the root storage of an Outlook message.
_MSG_CLSID = struct.pack("<IHH", 0x00020D0B, 0, 0) + bytes([0xC0, 0, 0, 0, 0, 0, 0, 0x46])


def make_msg(fields=None) -> bytes:
    f = {**MSG_FIELDS, **(fields or {})}

    def u(s: str) -> bytes:
        return s.encode("utf-16-le")

    # Top-level message property stream: a 32-byte header, then 16-byte
    # entries. PR_MESSAGE_CODEPAGE (0x3FFD, PT_LONG) = 65001 (UTF-8).
    props = b"\x00" * 32 + struct.pack("<IIQ", (0x3FFD << 16) | 0x0003, 0x6, 65001)
    return make_cfb(
        {
            "__properties_version1.0": props,
            "__substg1.0_001A001F": u("IPM.Note"),
            "__substg1.0_0037001F": u(f["subject"]),
            "__substg1.0_0C1F001F": u(f["sender"]),
            "__substg1.0_0E04001F": u(f["to"]),
            "__substg1.0_1000001F": u(f["body"]),
        },
        root_clsid=_MSG_CLSID,
    )


def write_all(directory: str) -> list[str]:
    os.makedirs(directory, exist_ok=True)
    files = {
        "northwind-handbook.docx": make_docx(),
        "northwind-roadmap.pptx": make_pptx(),
        "northwind-prices.xlsx": make_xlsx(),
        "northwind-sla.pdf": make_pdf(),
        "northwind-holiday-hours.msg": make_msg(),
    }
    paths = []
    for name, data in files.items():
        path = os.path.join(directory, name)
        with open(path, "wb") as fh:
            fh.write(data)
        paths.append(path)
    return paths


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python fixtures.py <output-dir>")
    for p in write_all(sys.argv[1]):
        print(p)
