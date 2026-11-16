"""Drive the panel the way a user does: type a prompt, press Generate, watch the
progress, see the model in the stage. Skipped where ``omni.ui`` cannot load
(a GPU-less node); the GCE GPU runner executes it.

``THREEWS_CAPTURE_DIR`` (optional) receives a screenshot of the panel after
the import.
"""

from __future__ import annotations

import asyncio
import os

import omni.kit.app
import omni.kit.test
import omni.usd
from pxr import UsdGeom

from .. import settings
from ..extension import get_controller, get_window
from .forge_server import GOOD_KEY, ForgeStandIn

try:
    import omni.ui as ui  # noqa: F401

    HAS_UI = True
except ImportError:
    HAS_UI = False


async def _frames(n: int = 3) -> None:
    app = omni.kit.app.get_app()
    for _ in range(n):
        await app.next_update_async()


async def _capture(name: str) -> str:
    out_dir = os.environ.get("THREEWS_CAPTURE_DIR", "")
    if not out_dir:
        return ""
    try:
        import omni.renderer_capture
    except ImportError:
        return ""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name)
    capture = omni.renderer_capture.acquire_renderer_capture_interface()
    capture.capture_next_frame_swapchain(path)
    await _frames(6)
    capture.wait_async_capture()
    return path


class TestForgePanel(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        if not HAS_UI or get_window() is None:
            self.skipTest("the panel needs omni.ui (a GPU or a UI-capable Kit app)")
        self.server = ForgeStandIn().start()
        self._saved = (settings.base_url(), settings.api_key() if settings.key_source() == "settings" else "")
        settings.set_base_url(self.server.base_url)
        settings.set_api_key(GOOD_KEY)
        get_controller().reload()
        await omni.usd.get_context().new_stage_async()
        stage = omni.usd.get_context().get_stage()
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
        stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())
        self.window = get_window()
        self.window.visible = True
        await _frames(5)

    async def tearDown(self):
        base, key = self._saved
        settings.set_base_url(base)
        if key:
            settings.set_api_key(key)
        else:
            settings.clear_api_key()
        get_controller().reload()
        self.server.stop()

    async def _wait_until(self, predicate, timeout: float = 60.0) -> None:
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        while not predicate():
            if loop.time() > deadline:
                self.fail("timed out waiting for the panel")
            await _frames(1)

    async def test_generate_from_the_panel_imports_into_the_stage(self):
        w = self.window
        await w._refresh_account()
        self.assertIn("accepted", w._account_label.text)
        self.assertIn("5 models", w._library_label.text)
        w._prompt_model.set_value("a brass ship lantern")
        w._name_model.set_value("panel lantern")
        w._generate_btn.call_clicked_fn()
        await _frames(2)
        self.assertFalse(w._generate_btn.enabled, "Generate is disabled while a job runs")
        self.assertTrue(w._cancel_btn.enabled)
        await self._wait_until(lambda: not get_controller().busy)
        self.assertIn("Imported at /World/threews/panel_lantern", w._status.text)
        self.assertTrue(w._generate_btn.enabled)
        stage = omni.usd.get_context().get_stage()
        self.assertTrue(stage.GetPrimAtPath("/World/threews/panel_lantern").IsValid())
        await _capture("panel-after-import.png")

    async def test_bad_key_shows_the_fix_button(self):
        w = self.window
        w._key_model.set_value("sk_test_this_key_does_not_exist")
        w._save_key()
        await self._wait_until(lambda: w._account_label.name == "status_error", 15)
        self.assertIn("did not accept", w._account_label.text)

    async def test_cancel_from_the_panel(self):
        w = self.window
        self.server.polls_until_done = 10_000
        w._prompt_model.set_value("a ship in a bottle")
        w._generate_btn.call_clicked_fn()
        await self._wait_until(lambda: "Generating" in w._status.text or "Queued" in w._status.text, 20)
        w._cancel_btn.call_clicked_fn()
        await self._wait_until(lambda: not get_controller().busy, 15)
        self.assertIn("Cancelled", w._status.text)
