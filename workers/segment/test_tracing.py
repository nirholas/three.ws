"""Tests for the vendored tracing module. Stdlib only: run with python -m unittest."""

import asyncio
import json
import time
import unittest

import tracing

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT = "00f067aa0ba902b7"


class ParseTests(unittest.TestCase):
    def test_parses_sampled_and_unsampled(self):
        self.assertEqual(tracing.parse_traceparent("00-%s-%s-01" % (TRACE, PARENT)), (TRACE, PARENT, True))
        self.assertEqual(tracing.parse_traceparent("00-%s-%s-00" % (TRACE, PARENT)), (TRACE, PARENT, False))

    def test_rejects_malformed(self):
        for bad in (None, "", "garbage", "00-%s-%s" % (TRACE, PARENT), "ff-%s-%s-01" % (TRACE, PARENT),
                    "00-%s-%s-01" % ("0" * 32, PARENT), "00-%s-%s-01" % (TRACE, "0" * 16)):
            self.assertIsNone(tracing.parse_traceparent(bad), bad)

    def test_round_trip(self):
        self.assertEqual(tracing.format_traceparent(TRACE, PARENT, True), "00-%s-%s-01" % (TRACE, PARENT))


class MiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        tracing._exporter.sender = self.sent.append
        tracing._exporter.threaded = False
        tracing._exporter.last_warn = 0

    def tearDown(self):
        tracing._exporter.sender = None
        tracing._exporter.threaded = True

    def drain(self):
        batch = []
        while not tracing._exporter.queue.empty():
            batch.append(tracing._exporter.queue.get_nowait())
        tracing._exporter.flush(batch)

    def call(self, headers, status=200, boom=False):
        async def app(scope, receive, send):
            with tracing.span("stage", model="x"):
                pass
            if boom:
                raise RuntimeError("worker exploded")
            await send({"type": "http.response.start", "status": status, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        mw = tracing.TraceMiddleware(app, service="unit")

        async def run():
            async def receive():
                return {"type": "http.request"}

            async def send(_):
                return None

            await mw({"type": "http", "method": "POST", "path": "/infer", "headers": headers}, receive, send)

        asyncio.run(run())

    def test_sampled_request_joins_the_inbound_trace(self):
        tp = "00-%s-%s-01" % (TRACE, PARENT)
        self.call([(b"traceparent", tp.encode())])
        self.drain()
        spans = self.sent[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        by_name = {s["name"]: s for s in spans}
        server = by_name["POST /infer"]
        self.assertEqual(server["traceId"], TRACE)
        self.assertEqual(server["parentSpanId"], PARENT)
        self.assertEqual(by_name["stage"]["parentSpanId"], server["spanId"])
        self.assertEqual(server["status"]["code"], 1)

    def test_unsampled_or_missing_header_records_nothing(self):
        self.call([(b"traceparent", ("00-%s-%s-00" % (TRACE, PARENT)).encode())])
        self.call([])
        self.assertTrue(tracing._exporter.queue.empty())
        self.assertEqual(self.sent, [])

    def test_error_response_marks_the_span(self):
        self.call([(b"traceparent", ("00-%s-%s-01" % (TRACE, PARENT)).encode())], status=503)
        self.drain()
        spans = self.sent[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        server = [s for s in spans if s["name"] == "POST /infer"][0]
        self.assertEqual(server["status"]["code"], 2)

    def test_exception_propagates_and_is_recorded(self):
        with self.assertRaises(RuntimeError):
            self.call([(b"traceparent", ("00-%s-%s-01" % (TRACE, PARENT)).encode())], boom=True)
        self.drain()
        spans = self.sent[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual([s for s in spans if s["name"] == "POST /infer"][0]["status"]["code"], 2)

    def test_export_failure_is_swallowed(self):
        def explode(_):
            raise OSError("network down")

        tracing._exporter.sender = explode
        self.call([(b"traceparent", ("00-%s-%s-01" % (TRACE, PARENT)).encode())])
        self.drain()


class ExportErrorTests(unittest.TestCase):
    """Production regression 2026-11-13: a rejected export logged only "HTTP Error 403: Forbidden"."""

    def test_rejected_export_names_the_denied_permission(self):
        import contextlib
        import io
        import urllib.error
        from unittest import mock

        body = json.dumps({"error": {"code": 403, "message": "Permission 'telemetry.traces.write' denied"}}).encode()

        def reject(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(body))

        exp = tracing._exporter
        exp.last_warn = 0
        exp.token, exp.token_expiry = "tok", time.time() + 3600
        out = io.StringIO()
        try:
            with mock.patch.object(tracing.urllib.request, "urlopen", reject), contextlib.redirect_stdout(out):
                exp.flush([tracing.Span("probe", tracing.SPAN_KIND_SERVER, TRACE, PARENT)])
        finally:
            exp.token, exp.token_expiry = None, 0.0
        self.assertIn("403", out.getvalue())
        self.assertIn("Permission 'telemetry.traces.write' denied", out.getvalue())


if __name__ == "__main__":
    unittest.main()
