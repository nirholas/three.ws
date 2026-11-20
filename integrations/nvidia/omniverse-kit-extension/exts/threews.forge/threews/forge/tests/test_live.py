"""End to end against the real three.ws API: a fresh GPU generation imported into
the stage, the account library, and the real error for a bad key.

Runs only when ``THREEWS_LIVE=1`` (it spends real GPU time). Generation and the
account tests also need ``THREEWS_API_KEY``: making a model needs an account. ``THREEWS_LIVE_REPORT`` names a JSON file that
receives the measured timings, so the GPU VM runner can publish them.

Both generation routes run: image to 3D from a public image URL
(``THREEWS_LIVE_IMAGE_URL``, a cache-busting query is added) and text to 3D.
``THREEWS_LIVE_TEXT=0`` skips the text route, for a run that has to measure the
image route while text to 3D is down on the server side.
"""

from __future__ import annotations

import json
import os
import time
import uuid

import omni.kit.test
import omni.usd
from pxr import Usd, UsdGeom

from .. import settings
from ..controller import ForgeController
from ..service import ForgeError, ForgeService, GenerationRequest

LIVE = os.environ.get("THREEWS_LIVE") == "1"
REPORT = os.environ.get("THREEWS_LIVE_REPORT", "")
# A real AI-generated product shot of a lantern, served by three.ws itself.
DEFAULT_IMAGE = "https://three.ws/cdn/forge/refs/1db6b71e-36cf-4692-a50c-b1451935da9c.jpg"


def _write_report(section: str, payload: dict) -> None:
    if not REPORT:
        return
    data = {}
    if os.path.isfile(REPORT):
        with open(REPORT, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    data[section] = payload
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


class TestLive(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        if not LIVE:
            self.skipTest("set THREEWS_LIVE=1 to run against the real three.ws API")

    async def test_real_image_generation_is_imported_upright(self):
        # A unique query so the Forge cache cannot answer: this must be a real GPU job.
        url = os.environ.get("THREEWS_LIVE_IMAGE_URL") or DEFAULT_IMAGE
        url += ("&" if "?" in url else "?") + "kit=" + uuid.uuid4().hex[:8]
        await self._generate_and_check("image_generation", GenerationRequest(image_path=url, lane="draft", name="live image lantern"))

    async def test_real_text_generation_is_imported_upright(self):
        if os.environ.get("THREEWS_LIVE_TEXT") == "0":
            self.skipTest("THREEWS_LIVE_TEXT=0")
        nonce = uuid.uuid4().hex[:8]
        prompt = f"a small weathered bronze ship lantern with a glass panel, studio product shot, item {nonce}"
        await self._generate_and_check("text_generation", GenerationRequest(prompt=prompt, lane="draft", name="live text lantern"))

    async def _generate_and_check(self, section: str, request: GenerationRequest) -> None:
        if not settings.api_key():
            self.skipTest("set THREEWS_API_KEY: making a model on three.ws needs an account")
        await omni.usd.get_context().new_stage_async()
        stage = omni.usd.get_context().get_stage()
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
        stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())

        controller = ForgeController()
        events = []
        controller.subscribe(lambda name, payload: events.append((time.monotonic(), name, payload)))
        started = time.monotonic()
        outcome = await controller.generate(request, placement="origin")
        total = time.monotonic() - started

        gen, imp = outcome.generation, outcome.imported
        self.assertFalse(gen.cached, "the unique input must produce a fresh generation")
        self.assertTrue(gen.job_id)
        self.assertTrue(os.path.getsize(gen.glb_path) > 1024)
        prim = stage.GetPrimAtPath(imp.prim_path)
        self.assertTrue(prim.IsValid())
        cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render], useExtentsHint=False)
        box = cache.ComputeWorldBound(prim).ComputeAlignedRange()
        self.assertFalse(box.IsEmpty())
        self.assertAlmostEqual(box.GetMin()[2], 0.0, delta=0.5, msg="grounded on the floor")
        progress = [p for _, n, p in events if n == "progress"]
        self.assertTrue(any(p.fraction is not None and p.fraction > 0.1 for p in progress), "real progress reported")
        self.assertIn("done", [n for _, n, _ in events])
        _write_report(
            section,
            {
                "input": request.image_path or request.prompt,
                "lane": gen.lane,
                "backend": gen.backend,
                "job_id": gen.job_id,
                "glb_url": gen.glb_url,
                "glb_bytes": gen.size_bytes,
                "generate_seconds": gen.seconds,
                "convert_seconds": imp.convert_seconds,
                "total_seconds": round(total, 2),
                "prim_path": imp.prim_path,
                "size_meters": list(imp.size_meters),
                "stage_up_axis": imp.up_axis_stage,
                "stage_meters_per_unit": imp.meters_per_unit_stage,
                "progress_events": len(progress),
            },
        )
        out_usd = os.environ.get("THREEWS_LIVE_STAGE", "")
        if out_usd:
            root, ext = os.path.splitext(out_usd)
            stage.Export(f"{root}-{section}{ext or '.usda'}")

    async def test_invalid_key_is_rejected_by_the_real_api(self):
        service = ForgeService(settings.base_url(), api_key="sk_live_" + uuid.uuid4().hex)
        with self.assertRaises(ForgeError) as ctx:
            service.account()
        self.assertEqual(ctx.exception.code, "invalid_api_key")
        _write_report("invalid_key", {"code": ctx.exception.code, "status": ctx.exception.status})

    async def test_account_and_library_with_a_real_key(self):
        key = os.environ.get("THREEWS_API_KEY", "")
        if not key:
            self.skipTest("set THREEWS_API_KEY to test the account and library")
        service = ForgeService(settings.base_url(), api_key=key)
        account = service.account()
        self.assertGreaterEqual(account.balance_usd, 0.0)
        models, cursor = service.list_models(limit=5)
        report = {"balance_known": True, "high_price_usd": account.high_price_usd, "library_page": len(models)}
        if models:
            await omni.usd.get_context().new_stage_async()
            stage = omni.usd.get_context().get_stage()
            stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())
            result = await ForgeController().import_library_model(models[0], placement="origin")
            self.assertTrue(stage.GetPrimAtPath(result.prim_path).IsValid())
            report["library_import"] = {"model_id": models[0].id, "prim_path": result.prim_path, "via": "usdz" if models[0].usdz_url else "glb"}
        _write_report("account", report)
