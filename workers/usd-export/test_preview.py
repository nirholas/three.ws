"""Local check for render_preview.py, the docs and review renderer.

Not part of the worker image or its build gate: the image has no matplotlib
and does not carry render_preview.py. Run from the source tree:

    python test_preview.py
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("API_KEY", "build-gate")
os.environ.setdefault("GCS_BUCKET", "build-gate")

import render_preview  # noqa: E402
from export import ExportOptions, export_glb  # noqa: E402
from PIL import Image  # noqa: E402
from test_export import box_glb  # noqa: E402


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="usd-preview-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_preview_renders_from_the_exported_stage(self):
        glb = box_glb(size=0.6)
        export_glb(glb, self.tmp, ExportOptions(prompt="a wooden crate", validate=False))
        src = Path(self.tmp, "source.glb")
        src.write_bytes(glb)
        png = Path(self.tmp, "preview.png")
        meta = render_preview.render(src, Path(self.tmp, "asset.usdz"), png)
        self.assertEqual(meta["label"], "box")
        self.assertGreaterEqual(meta["hulls"], 1)
        self.assertFalse(meta["kinematic"])
        self.assertGreater(meta["mass_kg"], 0)
        with Image.open(png) as img:
            self.assertGreater(img.width, 1000)
            # Not an empty frame: some pixels differ from the background.
            self.assertGreater(len(img.convert("RGB").getcolors(maxcolors=1 << 20) or []), 50)


if __name__ == "__main__":
    unittest.main()
