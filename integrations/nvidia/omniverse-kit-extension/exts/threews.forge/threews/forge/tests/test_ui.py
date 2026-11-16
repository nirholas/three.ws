"""Drive the panel the way a user does: type a prompt, press Generate, watch the
progress, see the model in the stage. Skipped where ``omni.ui`` cannot load
(a GPU-less node); the GCE GPU runner executes it.

``THREEWS_CAPTURE_DIR`` (optional) receives screenshots of the app window. With
``THREEWS_LIVE=1`` the live panel test also records one frame every two
seconds of a real generation, from the Generate press to the framed model, into
``frames/`` there; the runner turns those into the screen capture.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid

import omni.kit.app
import omni.kit.test
import omni.usd
from pxr import UsdGeom

from .. import settings
from ..extension import get_controller, get_window
from ..service import LANES
from .forge_server import GOOD_KEY, ForgeStandIn
from .test_live import DEFAULT_IMAGE, LIVE

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
    path = os.path.join(out_dir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
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

    async def test_reference_image_mode_sends_the_image(self):
        w = self.window
        url = "https://three.ws/cdn/forge/refs/panel-lantern.jpg"
        w._prompt_model.set_value("")
        w._mode_combo.model.get_item_value_model().set_value(1)
        w._image_model.set_value(url)
        await _frames(2)
        w._generate_btn.call_clicked_fn()
        await self._wait_until(lambda: not get_controller().busy)
        submit = [r for r in self.server.requests if r["method"] == "POST" and r["path"] == "/api/forge"]
        self.assertEqual(len(submit), 1, w._status.text)
        self.assertEqual(submit[0]["body"].get("image_urls"), [url])
        w._mode_combo.model.get_item_value_model().set_value(0)

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


def _dock_beside_viewport(window) -> None:
    """Dock the panel to the right of the viewport, the way a user lays it out."""
    viewport = ui.Workspace.get_window("Viewport")
    if viewport is not None:
        window.dock_in(viewport, ui.DockPosition.RIGHT, 0.26)


def _frame_in_viewport(prim_path: str) -> None:
    try:
        from omni.kit.viewport.utility import frame_viewport_selection, get_active_viewport
    except ImportError:
        return
    omni.usd.get_context().get_selection().set_selected_prim_paths([prim_path], True)
    viewport = get_active_viewport()
    if viewport is not None:
        frame_viewport_selection(viewport)


class TestLivePanel(omni.kit.test.AsyncTestCase):
    """A real image to 3D job started from the panel with a real key, recorded."""

    async def setUp(self):
        if not LIVE:
            self.skipTest("set THREEWS_LIVE=1 to run against the real three.ws API")
        if not HAS_UI or get_window() is None:
            self.skipTest("the panel needs omni.ui (a GPU or a UI-capable Kit app)")
        if not os.environ.get("THREEWS_API_KEY"):
            self.skipTest("set THREEWS_API_KEY so the panel shows a signed-in account")
        get_controller().reload()
        await omni.usd.get_context().new_stage_async()
        stage = omni.usd.get_context().get_stage()
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
        stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())
        self.window = get_window()
        self.window.visible = True
        _dock_beside_viewport(self.window)
        await _frames(10)

    async def test_real_generation_from_the_panel(self):
        w = self.window
        await w._refresh_account()
        await w._load_library(reset=True)
        url = DEFAULT_IMAGE + "?kit=" + uuid.uuid4().hex[:8]
        w._mode_combo.model.get_item_value_model().set_value(1)
        w._image_model.set_value(url)
        w._name_model.set_value("lantern")
        w._lane_combo.model.get_item_value_model().set_value(list(LANES).index("draft"))
        await _frames(5)
        await _capture("panel-ready.png")

        w._generate_btn.call_clicked_fn()
        loop = asyncio.get_event_loop()
        deadline = loop.time() + 900
        frame, next_shot = 0, 0.0
        while get_controller().busy:
            if loop.time() > deadline:
                self.fail("the real generation did not finish in 15 minutes")
            if time.monotonic() >= next_shot:
                await _capture(f"frames/frame_{frame:04d}.png")
                frame += 1
                next_shot = time.monotonic() + 2.0
            await _frames(1)

        self.assertIn("Imported at /World/threews/lantern", w._status.text)
        stage = omni.usd.get_context().get_stage()
        self.assertTrue(stage.GetPrimAtPath("/World/threews/lantern").IsValid())
        _frame_in_viewport("/World/threews/lantern")
        # Let the renderer converge on the framed model, still recording.
        for _ in range(8):
            await _frames(30)
            await _capture(f"frames/frame_{frame:04d}.png")
            frame += 1
        await _capture("panel-live-imported.png")
