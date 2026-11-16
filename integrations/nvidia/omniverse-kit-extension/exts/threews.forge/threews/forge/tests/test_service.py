"""Service behaviour that a production server cannot be made to show on demand:
retries, cancellation, error mapping and where the API key travels."""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import time

import omni.kit.test

from .. import service as svc
from .. import settings
from ..service import ForgeError, ForgeService, GenerationRequest, LibraryModel
from ..three_ws_client import ThreeWSError, is_glb
from .forge_server import BROKE_KEY, GOOD_KEY, ForgeStandIn


class _Fast:
    """Shrink every wait so the suite runs in seconds, then restore."""

    def __enter__(self):
        self._saved = (svc.POLL_INTERVAL, svc.BASE_DELAY)
        svc.POLL_INTERVAL = 0.05
        svc.BASE_DELAY = 0.05
        return self

    def __exit__(self, *exc):
        svc.POLL_INTERVAL, svc.BASE_DELAY = self._saved


class TestForgeService(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        self.server = ForgeStandIn().start()
        self.tmp = tempfile.mkdtemp(prefix="threews-forge-test-")
        self.fast = _Fast().__enter__()
        self.log_buffer = io.StringIO()
        self.log_handler = logging.StreamHandler(self.log_buffer)
        logging.getLogger("threews.forge").addHandler(self.log_handler)

    async def tearDown(self):
        logging.getLogger("threews.forge").removeHandler(self.log_handler)
        self.fast.__exit__()
        self.server.stop()

    def _service(self, key: str = "") -> ForgeService:
        return ForgeService(self.server.base_url, api_key=key, client_handle="kit-test-handle", cache_dir=self.tmp)

    async def test_standard_generation_reports_real_progress_and_downloads_a_glb(self):
        events = []
        result = self._service().generate(GenerationRequest(prompt="a brass lantern", lane="standard"), on_progress=events.append)
        self.assertTrue(os.path.isfile(result.glb_path))
        with open(result.glb_path, "rb") as fh:
            self.assertTrue(is_glb(fh.read()))
        self.assertEqual(result.job_id, "job1")
        self.assertEqual(result.backend, "fixture")
        fractions = [e.fraction for e in events if e.fraction is not None]
        self.assertEqual(fractions, sorted(fractions), "progress must never go backwards")
        running = [e for e in events if e.stage == "running"]
        self.assertTrue(running and running[0].eta_remaining == 10)
        self.assertAlmostEqual(running[0].fraction, 0.1 + 0.75 * 0.5)
        submit = self.server.requests_to("/api/forge")[0]
        self.assertEqual(submit["body"], {"prompt": "a brass lantern", "tier": "standard", "path": "image", "aspect_ratio": "1:1"})
        self.assertEqual(submit["headers"]["x-forge-client"], "kit-test-handle")
        self.assertEqual(submit["headers"]["user-agent"], svc.USER_AGENT)

    async def test_signed_job_token_longer_than_a_file_name_still_downloads(self):
        self.server.long_job_ids = True
        result = self._service().generate(GenerationRequest(prompt="a brass lantern"))
        self.assertTrue(result.job_id.startswith("f1.job1."))
        self.assertTrue(os.path.isfile(result.glb_path))
        self.assertLessEqual(len(os.path.basename(os.path.dirname(result.glb_path))), 64)

    async def test_cache_hit_needs_no_poll(self):
        self.server.cache_hit = True
        result = self._service().generate(GenerationRequest(prompt="a teapot", lane="draft"))
        self.assertTrue(result.cached)
        self.assertEqual(self.server.requests_to("/api/forge?job="), [])

    async def test_submit_is_retried_after_503(self):
        self.server.fail_submit = 2
        events = []
        result = self._service().generate(GenerationRequest(prompt="a chair"), on_progress=events.append)
        self.assertTrue(os.path.isfile(result.glb_path))
        self.assertEqual(len([r for r in self.server.requests if r["method"] == "POST"]), 3)
        self.assertTrue(any("retrying" in e.message for e in events))

    async def test_busy_generator_is_waited_out(self):
        self.server.busy_submit = 2
        result = self._service().generate(GenerationRequest(prompt="a stool"))
        self.assertTrue(os.path.isfile(result.glb_path))
        self.assertEqual(len([r for r in self.server.requests if r["method"] == "POST"]), 3)

    async def test_dropped_connection_mid_poll_keeps_the_job(self):
        self.server.drop_polls = 3
        events = []
        result = self._service().generate(GenerationRequest(prompt="a robot"), on_progress=events.append)
        self.assertEqual(result.job_id, "job1")
        self.assertTrue(any("Connection lost" in e.message for e in events))
        self.assertEqual(len([r for r in self.server.requests if r["method"] == "POST"]), 1, "a poll failure must not resubmit")

    async def test_download_is_retried_after_502(self):
        self.server.fail_download = 1
        result = self._service().generate(GenerationRequest(prompt="a crate"))
        self.assertTrue(os.path.isfile(result.glb_path))
        self.assertEqual(len(self.server.requests_to("/files/box.glb")), 2)

    async def test_persistent_outage_gives_up_with_a_clear_error(self):
        self.server.fail_submit = 99
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a lamp"))
        self.assertEqual(ctx.exception.status, 503)
        self.assertEqual(len([r for r in self.server.requests if r["method"] == "POST"]), svc.MAX_ATTEMPTS)

    async def test_failed_job_surfaces_the_server_reason(self):
        self.server.job_status = "failed"
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a vase"))
        self.assertEqual(ctx.exception.code, "failed")
        self.assertIn("out of memory", ctx.exception.message)

    async def test_cancel_during_poll_stops_promptly_and_imports_nothing(self):
        self.server.polls_until_done = 10_000
        svc.POLL_INTERVAL = 5.0
        cancel = threading.Event()
        threading.Timer(0.3, cancel.set).start()
        started = time.monotonic()
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a tree"), cancel=cancel)
        self.assertEqual(ctx.exception.code, "cancelled")
        self.assertLess(time.monotonic() - started, 2.0, "cancel must interrupt the poll wait")
        self.assertEqual(self.server.requests_to("/files/"), [])

    async def test_short_prompt_is_rejected_before_any_request(self):
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a"))
        self.assertEqual(ctx.exception.code, "invalid_prompt")
        self.assertEqual(self.server.requests, [])

    async def test_high_lane_without_key_says_where_to_get_one(self):
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a ship", lane="high"))
        self.assertEqual(ctx.exception.code, "missing_api_key")
        self.assertTrue(ctx.exception.url.endswith("/dashboard/api"))
        self.assertEqual(self.server.requests, [])

    async def test_high_lane_sends_key_credits_and_an_idempotency_ref(self):
        self._service(GOOD_KEY).generate(GenerationRequest(prompt="a ship", lane="high"))
        submit = self.server.requests_to("/api/forge")[0]
        self.assertEqual(submit["headers"]["authorization"], f"Bearer {GOOD_KEY}")
        self.assertEqual(submit["body"]["pay_with"], "credits")
        self.assertTrue(submit["body"]["ref_id"].startswith("kit-"))

    async def test_high_lane_retry_reuses_the_same_ref(self):
        self.server.fail_submit = 1
        self._service(GOOD_KEY).generate(GenerationRequest(prompt="a ship", lane="high"))
        refs = {r["body"]["ref_id"] for r in self.server.requests if r["method"] == "POST"}
        self.assertEqual(len(refs), 1, "a retried submit must never risk a second debit")

    async def test_out_of_credit_key_points_at_top_up(self):
        with self.assertRaises(ForgeError) as ctx:
            self._service(BROKE_KEY).generate(GenerationRequest(prompt="a ship", lane="high"))
        self.assertEqual(ctx.exception.code, "insufficient_credits")
        self.assertTrue(ctx.exception.url.endswith("/credits"))
        self.assertIn("Draft or Standard", ctx.exception.hint)

    async def test_invalid_key_is_named_as_such(self):
        with self.assertRaises(ForgeError) as ctx:
            self._service("sk_test_wrong").account()
        self.assertEqual(ctx.exception.code, "invalid_api_key")
        self.assertEqual(ctx.exception.status, 401)

    async def test_account_reads_balance_and_high_price(self):
        account = self._service(GOOD_KEY).account()
        self.assertEqual(account.balance_usd, 12.5)
        self.assertEqual(account.high_price_usd, 0.4)
        self.assertTrue(account.can_afford_high())
        self.assertFalse(self._service(BROKE_KEY).account().can_afford_high())

    async def test_key_never_reaches_anonymous_lanes_or_file_urls(self):
        self._service(GOOD_KEY).generate(GenerationRequest(prompt="a desk", lane="standard"))
        for req in self.server.requests:
            self.assertNotIn("authorization", req["headers"], req["path"])

    async def test_key_never_appears_in_logs_errors_or_repr(self):
        logging.getLogger("threews.forge").setLevel(logging.DEBUG)
        self.server.fail_submit = 1
        service = self._service(GOOD_KEY)
        service.generate(GenerationRequest(prompt="a desk", lane="high"))
        with self.assertRaises(ForgeError) as ctx:
            self._service(GOOD_KEY[:-1] + "9").account()
        text = "\n".join([self.log_buffer.getvalue(), repr(service), repr(service.client), str(ctx.exception)])
        self.assertNotIn(GOOD_KEY, text)
        self.assertNotIn(GOOD_KEY[8:], text)

    async def test_library_pages_and_private_download(self):
        service = self._service(GOOD_KEY)
        first, cursor = service.list_models(limit=3)
        self.assertEqual([m.id for m in first], ["m00", "m01", "m02"])
        second, cursor2 = service.list_models(cursor=cursor, limit=3)
        self.assertEqual([m.id for m in second], ["m03", "m04"])
        self.assertEqual(cursor2, "")
        path = service.fetch_library_model(first[0])
        with open(path, "rb") as fh:
            self.assertTrue(is_glb(fh.read()))
        download = self.server.requests_to("/api/avatars/m00/glb")[0]
        self.assertEqual(download["headers"]["authorization"], f"Bearer {GOOD_KEY}")

    async def test_library_without_key_asks_for_one(self):
        with self.assertRaises(ForgeError) as ctx:
            self._service().list_models()
        self.assertEqual(ctx.exception.code, "missing_api_key")

    async def test_non_glb_download_is_refused(self):
        self.server.glb = b"<html>not a model</html>"
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(prompt="a mug"))
        self.assertEqual(ctx.exception.code, "invalid_glb")

    async def test_public_image_url_is_sent_without_an_upload(self):
        url = "https://three.ws/cdn/forge/refs/lantern.jpg?v=2"
        request = GenerationRequest(image_path=url, lane="draft")
        self._service().generate(request)
        self.assertEqual(self.server.requests_to("/api/forge-upload"), [])
        submit = self.server.requests_to("/api/forge")[0]
        self.assertEqual(submit["body"], {"image_urls": [url], "tier": "draft", "path": "image"})
        self.assertEqual(request.display_name(), "lantern")

    async def test_local_image_is_uploaded_then_referenced(self):
        path = os.path.join(self.tmp, "mug.png")
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
        with open(path, "wb") as fh:
            fh.write(png)
        self._service().generate(GenerationRequest(image_path=path, lane="draft"))
        self.assertEqual(self.server.uploads.get("ref1"), png)
        presign = self.server.requests_to("/api/forge-upload")[0]["body"]
        self.assertEqual(presign["content_type"], "image/png")
        self.assertEqual(presign["size_bytes"], len(png))
        submit = [r for r in self.server.requests if r["method"] == "POST" and r["path"] == "/api/forge"][0]
        self.assertEqual(submit["body"]["image_urls"], [self.server.url("/refs/ref1")])

    async def test_upload_outage_suggests_a_public_url(self):
        self.server.storage_down = True
        path = os.path.join(self.tmp, "mug.png")
        with open(path, "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        with self.assertRaises(ForgeError) as ctx:
            self._service().generate(GenerationRequest(image_path=path, lane="draft"))
        self.assertEqual(ctx.exception.code, "storage_unavailable")
        self.assertIn("https://", ctx.exception.hint)
        self.assertEqual(self.server.requests_to("/api/forge?"), [])

    async def test_with_retries_does_not_retry_client_errors(self):
        calls = []

        def boom():
            calls.append(1)
            raise ThreeWSError("bad", code="invalid_prompt", status=400)

        with self.assertRaises(ThreeWSError):
            svc.with_retries(boom)
        self.assertEqual(len(calls), 1)


class TestSettings(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        self._saved_key = settings.api_key() if settings.key_source() == "settings" else ""
        self._env = os.environ.pop("THREEWS_API_KEY", None)

    async def tearDown(self):
        if self._saved_key:
            settings.set_api_key(self._saved_key)
        else:
            settings.clear_api_key()
        if self._env is not None:
            os.environ["THREEWS_API_KEY"] = self._env

    async def test_key_round_trips_and_redacts(self):
        settings.set_api_key("  sk_live_abcdefghijklmnop  ")
        self.assertEqual(settings.api_key(), "sk_live_abcdefghijklmnop")
        self.assertEqual(settings.key_source(), "settings")
        red = settings.redact(settings.api_key())
        self.assertTrue(red.startswith("sk_live_"))
        self.assertNotIn("ijklmnop", red)
        settings.clear_api_key()
        self.assertEqual(settings.api_key(), "")

    async def test_environment_key_is_a_fallback(self):
        settings.clear_api_key()
        os.environ["THREEWS_API_KEY"] = "sk_test_from_environment"
        try:
            self.assertEqual(settings.api_key(), "sk_test_from_environment")
            self.assertEqual(settings.key_source(), "environment")
        finally:
            del os.environ["THREEWS_API_KEY"]

    async def test_key_shape_check(self):
        self.assertTrue(settings.looks_like_key("sk_live_" + "a" * 24))
        self.assertFalse(settings.looks_like_key("pk_live_abc"))
        self.assertFalse(settings.looks_like_key(""))

    async def test_client_handle_is_stable(self):
        self.assertEqual(settings.client_handle(), settings.client_handle())


class TestLibraryModelShape(omni.kit.test.AsyncTestCase):
    async def test_rows_without_id_are_skipped(self):
        server = ForgeStandIn().start()
        try:
            server.models = [{"name": "no id"}, {"id": "x1"}]
            models, _ = ForgeService(server.base_url, api_key=GOOD_KEY, cache_dir=tempfile.mkdtemp()).list_models()
            self.assertEqual([m.id for m in models], ["x1"])
            self.assertIsInstance(models[0], LibraryModel)
            self.assertEqual(models[0].name, "Untitled")
        finally:
            server.stop()
