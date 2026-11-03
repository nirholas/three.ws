"""Tests for matting.py, the reference-image preparation PartCrafter runs on.

    python3 workers/model-partcrafter/test_matting.py

Needs numpy, Pillow and scipy only. The geometry checks drive
prepare_reference_image with a mask computed from the test image's own pixels
(a dark subject on a light ground), so they are exact and fast, and they run
in the Docker build gate.

When the BiRefNet weights are present (MATTING_MODEL_PATH, default
/app/models/birefnet-general.onnx) and onnxruntime is installed, the real
model also runs on the CC0 chair photo in data/quality-bench/refs/ (sources in
that directory's SOURCES.md; override with MATTING_REFERENCE_IMAGE). That pass
takes minutes on a CPU, so it runs locally and on the GPU host, not in the
image build.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from matting import (  # noqa: E402
    MAX_SIDE,
    ForegroundNotFound,
    otsu_threshold,
    prepare_reference_image,
)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def darkness_mask(rgb: Image.Image) -> np.ndarray:
    """Soft alpha = how dark each pixel is: a dark subject on a light ground."""
    arr = np.asarray(rgb.convert("L"), dtype=np.float32)
    return 1.0 - arr / 255.0


def scene(width: int, height: int, box: tuple[int, int, int, int], speck: tuple[int, int] | None = None) -> Image.Image:
    arr = np.full((height, width, 3), 235, dtype=np.uint8)
    x, y, w, h = box
    arr[y:y + h, x:x + w] = (30, 40, 120)
    if speck:
        sx, sy = speck
        arr[sy:sy + 5, sx:sx + 5] = (20, 20, 20)
    return Image.fromarray(arr, "RGB")


def test_otsu() -> None:
    gray = np.concatenate([np.full(500, 20, np.uint8), np.full(500, 220, np.uint8)])
    t = otsu_threshold(gray)
    check("otsu splits a bimodal histogram between its modes", 20 <= t < 220, f"t={t}")
    check("otsu of an empty array is 0", otsu_threshold(np.array([], np.uint8)) == 0)


def test_masked_framing() -> None:
    out = prepare_reference_image(scene(400, 300, (100, 50, 120, 200)), darkness_mask)
    arr = np.asarray(out)
    check("output is RGB", out.mode == "RGB")
    check("output is square", out.width == out.height, str(out.size))
    check("square side is the long side plus 10% padding each way", out.width == 240, str(out.size))
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    check("background is composited to white", all((c == 255).all() for c in corners), str(corners))
    centre = arr[out.height // 2, out.width // 2]
    check("subject colour survives at the centre", tuple(centre) == (30, 40, 120), str(centre))
    cols = np.nonzero((arr != 255).any(axis=2).any(axis=0))[0]
    check("subject is horizontally centred", abs((cols[0] + cols[-1]) / 2 - (out.width - 1) / 2) <= 1, str((cols[0], cols[-1])))


def test_specks_dropped() -> None:
    clean = prepare_reference_image(scene(400, 300, (100, 50, 120, 200)), darkness_mask)
    specked = prepare_reference_image(scene(400, 300, (100, 50, 120, 200), speck=(350, 10)), darkness_mask)
    check("a sub-200px speck neither moves the crop nor survives it", clean.size == specked.size and
          np.array_equal(np.asarray(clean), np.asarray(specked)))


def test_supplied_alpha_is_used() -> None:
    rgba = np.zeros((200, 200, 4), dtype=np.uint8)
    rgba[..., :3] = (200, 10, 10)
    rgba[50:150, 60:140, 3] = 255
    rgba[50:150, 59, 3] = 128

    def must_not_run(_rgb: Image.Image) -> np.ndarray:
        raise AssertionError("mask_fn ran although the input carried a usable alpha")

    try:
        out = prepare_reference_image(Image.fromarray(rgba, "RGBA"), must_not_run)
        ok = True
    except AssertionError:
        out, ok = None, False
    check("a transparent PNG's own alpha is used instead of re-matting", ok)
    if out is not None:
        arr = np.asarray(out)
        row = arr[out.height // 2]
        soft = [px for px in row if not (px == 255).all() and not tuple(px) == (200, 10, 10)]
        check("soft alpha edges are kept, not binarised", len(soft) > 0)


def test_opaque_alpha_falls_back_to_matting() -> None:
    rgba = np.asarray(scene(300, 300, (100, 100, 100, 100)).convert("RGBA")).copy()
    called = []

    def recording_mask(rgb: Image.Image) -> np.ndarray:
        called.append(rgb.size)
        return darkness_mask(rgb)

    prepare_reference_image(Image.fromarray(rgba, "RGBA"), recording_mask)
    check("a fully opaque alpha channel is ignored and the image is matted", called == [(300, 300)], str(called))


def test_no_subject() -> None:
    for label, img in (
        ("a blank image", Image.new("RGB", (300, 300), (255, 255, 255))),
        ("only noise-sized specks", scene(300, 300, (0, 0, 0, 0), speck=(100, 100))),
    ):
        try:
            prepare_reference_image(img, darkness_mask)
            check(f"{label} raises ForegroundNotFound", False, "no exception")
        except ForegroundNotFound:
            check(f"{label} raises ForegroundNotFound", True)


def test_downscale() -> None:
    seen = []

    def recording_mask(rgb: Image.Image) -> np.ndarray:
        seen.append(rgb.size)
        return darkness_mask(rgb)

    prepare_reference_image(scene(4000, 1000, (1000, 200, 1500, 600)), recording_mask)
    check("oversized inputs are downscaled before matting", seen and max(seen[0]) == MAX_SIDE, str(seen))


def test_real_birefnet() -> None:
    model = os.environ.get("MATTING_MODEL_PATH", "/app/models/birefnet-general.onnx")
    here = os.path.dirname(os.path.abspath(__file__))
    ref = os.environ.get(
        "MATTING_REFERENCE_IMAGE",
        os.path.join(here, "..", "..", "data", "quality-bench", "refs", "chair.jpg"),
    )
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        print("skip  real BiRefNet pass (onnxruntime not installed)")
        return
    if not (os.path.isfile(model) and os.path.isfile(ref)):
        print(f"skip  real BiRefNet pass (model {model} or reference {ref} absent)")
        return

    from matting import BiRefNetMatter

    matter = BiRefNetMatter(model)
    print(f"      BiRefNet bound to {matter.providers}")
    out = prepare_reference_image(Image.open(ref), matter)
    arr = np.asarray(out)
    check("real matte: output is square", out.width == out.height, str(out.size))
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    check("real matte: every border pixel is white", (border == 255).all(), f"min={border.min()}")
    coverage = float((arr < 250).any(axis=2).mean())
    check("real matte: the subject fills a plausible share of the frame", 0.15 < coverage < 0.85, f"{coverage:.3f}")


if __name__ == "__main__":
    test_otsu()
    test_masked_framing()
    test_specks_dropped()
    test_supplied_alpha_is_used()
    test_opaque_alpha_falls_back_to_matting()
    test_no_subject()
    test_downscale()
    test_real_birefnet()
    if failures:
        print(f"\n{len(failures)} check(s) failed")
        sys.exit(1)
    print("\nall checks passed")
