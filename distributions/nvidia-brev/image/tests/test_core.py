"""
Unit gate for studio/core.py. Runs on a CPU (no torch import) locally and in the
Docker build, where a failure stops the image from shipping:

  python tests/test_core.py
"""

import io
import json
import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from studio import core  # noqa: E402


def _png(size=(32, 32), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (200, 50, 50) if mode == "RGB" else None).save(buf, format="PNG")
    return buf.getvalue()


class OpenImageTests(unittest.TestCase):
    def test_png_jpeg_webp_decode(self):
        for fmt in ("PNG", "JPEG", "WEBP"):
            buf = io.BytesIO()
            Image.new("RGB", (16, 16), (1, 2, 3)).save(buf, format=fmt)
            img = core.open_image(buf.getvalue())
            self.assertEqual(img.size, (16, 16), fmt)

    def test_rejects_other_formats(self):
        buf = io.BytesIO()
        Image.new("RGB", (16, 16)).save(buf, format="BMP")
        with self.assertRaises(core.InputError):
            core.open_image(buf.getvalue())

    def test_rejects_garbage_and_empty(self):
        with self.assertRaises(core.InputError):
            core.open_image(b"not an image at all")
        with self.assertRaises(core.InputError):
            core.open_image(b"")

    def test_rejects_oversized_upload(self):
        with self.assertRaises(core.InputError):
            core.open_image(b"\x89PNG" + b"0" * (core.MAX_UPLOAD_BYTES + 1))


class ValidationTests(unittest.TestCase):
    def test_resolution_bounds(self):
        self.assertEqual(core.parse_resolution(None), 256)
        self.assertEqual(core.parse_resolution(""), 256)
        self.assertEqual(core.parse_resolution("320"), 320)
        for bad in ("63", "321", "abc", "1e3"):
            with self.assertRaises(core.InputError, msg=bad):
                core.parse_resolution(bad)

    def test_output_ids_cannot_traverse(self):
        oid = core.new_output_id()
        self.assertTrue(core.is_output_id(oid))
        for bad in ("../etc/passwd", "ABCDEF0123456789", "abc", "", "0123456789abcdef0"):
            self.assertFalse(core.is_output_id(bad), bad)

    def test_sample_names(self):
        self.assertTrue(core.is_sample_name("chair.png"))
        self.assertTrue(core.is_sample_name("poly_fox.png"))
        for bad in ("../chair.png", "chair.gif", "Chair.png", "a/b.png"):
            self.assertFalse(core.is_sample_name(bad), bad)


class TimingTests(unittest.TestCase):
    def test_report_orders_stages_and_totals(self):
        r = core.TimingReport()
        r.record("export_ms", 10)
        r.record("background_removal_ms", 100.04)
        r.record("model_forward_ms", 200)
        d = r.as_dict()
        self.assertEqual(list(d), ["background_removal_ms", "model_forward_ms", "export_ms", "total_ms"])
        self.assertEqual(d["total_ms"], 310.0)

    def test_unknown_stage_is_a_bug(self):
        with self.assertRaises(KeyError):
            core.TimingReport().record("made_up_ms", 1)

    def test_summarize_runs(self):
        runs = [{"model_forward_ms": v, "total_ms": v * 2} for v in (100, 300, 200)]
        s = core.summarize_runs(runs)
        self.assertEqual(s["model_forward_ms"], {"median": 200, "min": 100, "max": 300, "runs": 3})
        self.assertEqual(s["total_ms"]["median"], 400)
        with self.assertRaises(ValueError):
            core.summarize_runs([])


class NodeSelfTestParsing(unittest.TestCase):
    OUT = (
        "[node] identity 7Xf3Kq9ZkP1mN2bV4cX6zL8aS9dF2gH4jK6kM8nB3vC1 (generated, saved to /x)\n"
        "[node] platform https://three.ws · capability text-embedding · model Xenova/all-MiniLM-L6-v2 · device cuda\n"
        "[node] running proof workload self-test (first run downloads the model)...\n"
        "[node] self-test OK: Xenova/all-MiniLM-L6-v2, 384 dims, ran on cuda (fp32) in 412ms\n"
    )

    def test_parses_the_operator_line(self):
        r = core.parse_node_self_test(self.OUT)
        self.assertEqual(r["device"], "cuda")
        self.assertEqual(r["dtype"], "fp32")
        self.assertEqual(r["dimensions"], 384)
        self.assertEqual(r["elapsed_ms"], 412)
        self.assertTrue(r["ok"])
        self.assertEqual(r["public_key"], "7Xf3Kq9ZkP1mN2bV4cX6zL8aS9dF2gH4jK6kM8nB3vC1")

    def test_failure_without_result_line(self):
        with self.assertRaises(ValueError):
            core.parse_node_self_test("[node] fatal: could not load model")

    def test_matches_the_operator_source(self):
        """The regex tracks packages/node-operator/src/index.js; fail loudly if that line changes."""
        src = ROOT.parent / "node-operator" / "src" / "index.js"
        if not src.exists():
            src = ROOT.parents[2] / "packages" / "node-operator" / "src" / "index.js"
        text = src.read_text(encoding="utf-8")
        self.assertIn("self-test ${result.ok ? 'OK' : 'FAILED'}: ${result.model}, ${result.dimensions} dims, ran on ${result.device} (${result.dtype}) in ${result.elapsedMs}ms", text)


class NotebookTests(unittest.TestCase):
    def test_notebook_is_valid_and_uses_the_helpers(self):
        nb = json.loads((ROOT / "notebooks" / "three-ws-gpu-quickstart.ipynb").read_text(encoding="utf-8"))
        self.assertEqual(nb["nbformat"], 4)
        code = "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
        for call in ("tw.wait_until_ready", "tw.generate", "tw.viewer_html", "tw.node_self_test", "summarize_runs"):
            self.assertIn(call, code)
        for cell in nb["cells"]:
            if cell["cell_type"] == "code":
                self.assertEqual(cell["outputs"], [], "ship the notebook without stored outputs")


if __name__ == "__main__":
    unittest.main()
