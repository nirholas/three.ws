"""
Request policy tests for the MarkItDown worker: format detection by magic
number and structure, extension and MIME agreement, the size cap, and the
OOXML zip-bomb guard. Run with ``python test_policy.py`` (the Docker build runs
it as a gate, so an image whose guards regress never ships).
"""

from __future__ import annotations

import io
import sys
import unittest
import zipfile

import fixtures
from policy import (
    MAX_UPLOAD_BYTES,
    PolicyError,
    check_ooxml_archive,
    validate_upload,
)


def _zip(entries, compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _docx_like(extra_entries) -> bytes:
    base = [
        ("[Content_Types].xml", fixtures.DOCX_CONTENT_TYPES),
        ("word/document.xml", "<w:document/>"),
    ]
    return _zip(base + list(extra_entries))


class DetectionTests(unittest.TestCase):
    def test_each_supported_format_is_detected_from_real_bytes(self):
        cases = {
            "handbook.docx": (fixtures.make_docx(), "docx"),
            "deck.pptx": (fixtures.make_pptx(), "pptx"),
            "prices.xlsx": (fixtures.make_xlsx(), "xlsx"),
            "brief.pdf": (fixtures.make_pdf(), "pdf"),
            "note.msg": (fixtures.make_msg(), "msg"),
        }
        for name, (data, kind) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(validate_upload(data, name, "").kind, kind)

    def test_extension_is_case_insensitive(self):
        self.assertEqual(validate_upload(fixtures.make_pdf(), "BRIEF.PDF", "application/pdf").kind, "pdf")

    def test_a_pptx_renamed_to_docx_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(fixtures.make_pptx(), "deck.docx", "")
        self.assertEqual(ctx.exception.code, "type_mismatch")

    def test_docx_bytes_named_pdf_are_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(fixtures.make_docx(), "brief.pdf", "application/pdf")
        self.assertEqual(ctx.exception.code, "type_mismatch")

    def test_unsupported_extension_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(b"hello world", "notes.txt", "text/plain")
        self.assertEqual(ctx.exception.code, "unsupported_type")

    def test_a_plain_zip_named_docx_is_rejected(self):
        data = _zip([("readme.txt", "not an office file")])
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(data, "fake.docx", "")
        self.assertEqual(ctx.exception.code, "type_mismatch")

    def test_garbage_with_an_office_extension_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(b"PK\x03\x04this is not a zip at all", "x.xlsx", "")
        self.assertEqual(ctx.exception.code, "invalid_file")

    def test_an_ole_file_that_is_not_an_outlook_message_is_rejected(self):
        data = fixtures.make_cfb({"WordDocument": b"\x00" * 64})
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(data, "note.msg", "")
        self.assertEqual(ctx.exception.code, "type_mismatch")


class MimeTests(unittest.TestCase):
    def test_matching_and_generic_mimes_are_accepted(self):
        data = fixtures.make_xlsx()
        for mime in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
            "",
        ):
            with self.subTest(mime=mime):
                self.assertEqual(validate_upload(data, "p.xlsx", mime).kind, "xlsx")

    def test_mime_parameters_are_ignored(self):
        self.assertEqual(validate_upload(fixtures.make_pdf(), "a.pdf", "application/pdf; charset=binary").kind, "pdf")

    def test_a_mime_that_names_another_type_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(fixtures.make_xlsx(), "p.xlsx", "application/pdf")
        self.assertEqual(ctx.exception.code, "type_mismatch")

    def test_an_html_mime_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(fixtures.make_docx(), "a.docx", "text/html")
        self.assertEqual(ctx.exception.code, "type_mismatch")


class SizeTests(unittest.TestCase):
    def test_empty_upload_is_rejected(self):
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(b"", "a.pdf", "application/pdf")
        self.assertEqual(ctx.exception.code, "empty_file")

    def test_upload_over_the_cap_is_rejected_with_413(self):
        data = b"%PDF-1.4\n" + b"0" * MAX_UPLOAD_BYTES
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(data, "big.pdf", "application/pdf")
        self.assertEqual(ctx.exception.code, "file_too_large")
        self.assertEqual(ctx.exception.status, 413)


class ZipBombTests(unittest.TestCase):
    def test_a_normal_office_archive_passes_and_reports_its_shape(self):
        info = check_ooxml_archive(fixtures.make_docx())
        self.assertGreater(info["entries"], 2)
        self.assertGreater(info["uncompressed_bytes"], 0)

    def test_a_highly_compressed_entry_is_rejected(self):
        # 40 MiB of zeros deflates to roughly 40 KiB: the classic bomb shape.
        data = _docx_like([("word/media/blob.bin", b"\x00" * (40 * 1024 * 1024))])
        self.assertLess(len(data), 200 * 1024)
        with self.assertRaises(PolicyError) as ctx:
            validate_upload(data, "bomb.docx", "")
        self.assertEqual(ctx.exception.code, "zip_bomb")

    def test_total_uncompressed_size_is_capped(self):
        # Incompressible entries (stored) so the ratio guard does not fire first.
        chunk = bytes(range(256)) * 4096  # 1 MiB
        data = _docx_like([(f"word/media/{i}.bin", chunk) for i in range(6)])
        with self.assertRaises(PolicyError) as ctx:
            check_ooxml_archive(data, max_total_bytes=4 * 1024 * 1024)
        self.assertEqual(ctx.exception.code, "zip_bomb")

    def test_entry_count_is_capped(self):
        data = _docx_like([(f"word/x/{i}.xml", "<a/>") for i in range(60)])
        with self.assertRaises(PolicyError) as ctx:
            check_ooxml_archive(data, max_entries=50)
        self.assertEqual(ctx.exception.code, "zip_bomb")

    def test_a_nested_archive_is_rejected(self):
        inner = _zip([("a.txt", "x")])
        data = _docx_like([("word/embeddings/inner.zip", inner)])
        with self.assertRaises(PolicyError) as ctx:
            check_ooxml_archive(data)
        self.assertEqual(ctx.exception.code, "zip_bomb")

    def test_path_traversal_entry_names_are_rejected(self):
        data = _docx_like([("../../etc/passwd", "x")])
        with self.assertRaises(PolicyError) as ctx:
            check_ooxml_archive(data)
        self.assertEqual(ctx.exception.code, "invalid_file")

    def test_an_encrypted_entry_is_rejected(self):
        data = bytearray(_docx_like([]))
        # Flip the encryption bit (general purpose flag bit 0) in every central
        # directory header, which is what zipfile reads.
        sig = b"PK\x01\x02"
        i = data.find(sig)
        while i != -1:
            data[i + 8] |= 0x01
            i = data.find(sig, i + 4)
        with self.assertRaises(PolicyError) as ctx:
            check_ooxml_archive(bytes(data))
        self.assertEqual(ctx.exception.code, "invalid_file")


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
