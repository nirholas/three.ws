"""Build-time guard for the pre-inference path. Run: python test_splat_prep.py"""

import base64
import io
import unittest

from PIL import Image

import splat_prep as sp


def _png_uri(mode="RGBA", size=(8, 8)):
    buf = io.BytesIO()
    Image.new(mode, size, (200, 10, 10, 255)[: len(mode)]).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


class SplatPrepTests(unittest.TestCase):
    def test_data_uri_decodes_to_rgba(self):
        img = sp.decode_image(_png_uri("RGB"), fetch=lambda u: b"")
        self.assertEqual(img.mode, "RGBA")
        self.assertEqual(img.size, (8, 8))

    def test_https_goes_through_fetch(self):
        raw = base64.b64decode(_png_uri().split(",", 1)[1])
        seen = []
        img = sp.decode_image("https://example.com/a.png", fetch=lambda u: seen.append(u) or raw)
        self.assertEqual(seen, ["https://example.com/a.png"])
        self.assertEqual(img.size, (8, 8))

    def test_other_schemes_never_reach_fetch(self):
        for src in ("http://example.com/a.png", "file:///etc/passwd", "gs://b/o", "ftp://x/y"):
            with self.assertRaises(ValueError):
                sp.decode_image(src, fetch=lambda u: self.fail("fetch called"))

    def test_malformed_payloads_rejected(self):
        for src in ("data:image/png;base64,!!!", "data:image/png,abc", "data:image/png;base64,AAAA"):
            with self.assertRaises(ValueError):
                sp.decode_image(src, fetch=lambda u: b"")

    def test_gaussian_bounds(self):
        self.assertEqual(sp.clamp_gaussians(None), sp.DEFAULT_GAUSSIANS)
        self.assertEqual(sp.clamp_gaussians(262144), 262144)
        self.assertEqual(sp.clamp_gaussians(32768), 32768)
        # Upstream TripoSplatPipeline asserts num_gaussians >= 32768; a lower
        # count must be refused as input, not crash the job on the GPU.
        for bad in (0, 8192, 32767, 262145, True, "40000", 40000.5):
            with self.assertRaises(ValueError):
                sp.clamp_gaussians(bad)

    def test_weight_staging_manifest(self):
        paths = sp.pipeline_weight_paths("/tmp/w/")
        self.assertEqual(
            set(paths),
            {"ckpt_path", "decoder_path", "dinov3_path", "flux2_vae_encoder_path", "rmbg_path"},
        )
        self.assertEqual(paths["dinov3_path"], "/tmp/w/clip_vision/dino_v3_vit_h.safetensors")
        names = sp.weight_blob_names("/triposplat/")
        self.assertEqual(len(names), 5)
        self.assertIn("triposplat/vae/flux2-vae.safetensors", names)
        self.assertTrue(all(n.endswith(".safetensors") for n in names))

    def test_blob_names(self):
        self.assertEqual(sp.splat_blob_name("t1", "ply"), "raw-splats/triposplat/t1.ply")
        with self.assertRaises(ValueError):
            sp.splat_blob_name("t1", "exe")
        self.assertEqual(sp.splat_public_url("b", "x/y.ply"), "https://storage.googleapis.com/b/x/y.ply")


if __name__ == "__main__":
    unittest.main()
