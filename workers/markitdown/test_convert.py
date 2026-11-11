"""
Conversion tests against real, self-authored files of every supported format
(fixtures.py), run through the same isolated child process the service uses.
The Docker build runs this as a gate.
"""

from __future__ import annotations

import multiprocessing as mp
import sys
import unittest

import fixtures
from convert import ConversionError, _disable_network, convert_document


def _probe_network(conn):
    _disable_network()
    import socket
    import urllib.request

    outcomes = []
    for attempt in (
        lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM),
        lambda: socket.getaddrinfo("example.com", 443),
        lambda: urllib.request.urlopen("http://example.com", timeout=2),
    ):
        try:
            attempt()
            outcomes.append("allowed")
        except OSError:
            outcomes.append("refused")
    conn.send(outcomes)
    conn.close()


class ConvertTests(unittest.TestCase):
    def test_docx_headings_survive(self):
        md, meta = convert_document("docx", fixtures.make_docx())
        self.assertIn("# Northwind Field Handbook", md)
        self.assertIn("## Returns policy", md)
        self.assertIn("45 days", md)
        self.assertEqual(meta["title"], "Northwind Field Handbook")

    def test_pptx_marks_every_slide(self):
        md, meta = convert_document("pptx", fixtures.make_pptx())
        self.assertEqual(meta["slides"], len(fixtures.PPTX_SLIDES))
        self.assertIn("<!-- Slide number: 3 -->", md)
        self.assertIn("Parts locker", md)
        self.assertEqual(meta["title"], "Northwind 2027 roadmap")

    def test_xlsx_sheets_become_tables(self):
        md, meta = convert_document("xlsx", fixtures.make_xlsx())
        self.assertEqual(meta["sheets"], 2)
        self.assertIn("## Price list", md)
        self.assertIn("| NW-210 | Screen replacement, 13 inch | 189 |", md)

    def test_pdf_text_and_page_count(self):
        md, meta = convert_document("pdf", fixtures.make_pdf())
        self.assertIn("within 4 hours", md)
        self.assertEqual(meta["pages"], 2)
        self.assertEqual(meta["title"], "Northwind Service Level Brief")

    def test_msg_headers_and_body(self):
        md, meta = convert_document("msg", fixtures.make_msg())
        self.assertIn("**Subject:** Holiday opening hours", md)
        self.assertIn("closes at 14:00 on 24 December", md)
        self.assertEqual(meta["title"], "Holiday opening hours")

    def test_a_corrupt_file_reports_a_conversion_error(self):
        bad = fixtures.make_pdf()[:40]
        with self.assertRaises(ConversionError) as ctx:
            convert_document("pdf", bad + b"garbage")
        self.assertIn(ctx.exception.code, {"conversion_failed", "conversion_crashed"})

    def test_a_conversion_over_the_time_limit_is_stopped(self):
        with self.assertRaises(ConversionError) as ctx:
            convert_document("xlsx", fixtures.make_xlsx(), timeout=0.0001)
        self.assertEqual(ctx.exception.code, "conversion_timeout")

    def test_network_is_disabled_inside_the_converter(self):
        ctx = mp.get_context("forkserver")
        parent, child = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=_probe_network, args=(child,))
        proc.start()
        child.close()
        self.assertTrue(parent.poll(20))
        self.assertEqual(parent.recv(), ["refused", "refused", "refused"])
        proc.join(5)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
