"""
Reference-image preparation for PartCrafter: isolate the subject, composite it
onto a flat white ground, and centre it in a padded square. That framing is
what PartCrafter's image encoder was conditioned on during training, so a raw
photo with a busy background yields noticeably worse parts.

Foreground matting uses BiRefNet (ZhengPeng7/BiRefNet, MIT), run through
onnxruntime from the ONNX export the rembg project (danielgatis/rembg, MIT)
publishes. Upstream PartCrafter preprocesses with BRIA RMBG-1.4 instead, but
that model is licensed for non-commercial use only, so this worker never loads
it. The crop/composite/pad steps are this worker's own implementation of the
same framing upstream describes (subject bounding box, 10% padding, square).

Everything here is CPU-side numpy/PIL plus onnxruntime, so test_matting.py can
run it with real weights on a machine without a GPU or PartCrafter's checkout.
"""
from __future__ import annotations

import threading
from typing import Callable

import numpy as np
from PIL import Image, ImageOps

BIREFNET_INPUT_SIZE = 1024
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Inputs larger than this on their long side are downscaled first: matting
# runs at 1024 anyway, and the encoder sees far less than this.
MAX_SIDE = 2000
# Connected foreground blobs smaller than this many pixels are matting noise.
MIN_COMPONENT_PX = 200
# A supplied alpha channel is trusted only when at least this fraction of the
# image is clearly transparent AND clearly opaque; a near-uniform alpha (an
# opaque PNG, a faint vignette) carries no subject outline.
VALID_ALPHA_MIN_FRACTION = 0.01
DEFAULT_PADDING_RATIO = 0.1

MaskFn = Callable[[Image.Image], np.ndarray]


class ForegroundNotFound(ValueError):
    """No subject could be isolated from the image (blank, uniformly coloured,
    or so small that every candidate region was noise). The caller's input is
    at fault, so main.py reports it as a failed job with this message."""


class BiRefNetMatter:
    """Callable foreground matter: RGB PIL image in, float32 HxW alpha in
    [0, 1] out, at the input's own resolution.

    Runs on the GPU when onnxruntime-gpu can see one (the deployed image ships
    onnxruntime-gpu, and torch's own nvidia-cudnn/cublas wheels satisfy its
    CUDA 12 / cuDNN 9 runtime), else on the CPU. BiRefNet at 1024px is a
    Swin-L backbone, so the CPU path is for tests and local runs; `providers`
    reports which one was actually bound so the service can log it."""

    def __init__(self, onnx_path: str, prefer_gpu: bool = True):
        import onnxruntime as ort

        wanted = ["CPUExecutionProvider"]
        if prefer_gpu and "CUDAExecutionProvider" in ort.get_available_providers():
            if hasattr(ort, "preload_dlls"):
                ort.preload_dlls()
            wanted.insert(0, "CUDAExecutionProvider")
        self._session = ort.InferenceSession(onnx_path, providers=wanted)
        self.providers = list(self._session.get_providers())
        self._input_name = self._session.get_inputs()[0].name
        self._lock = threading.Lock()

    def __call__(self, rgb: Image.Image) -> np.ndarray:
        width, height = rgb.size
        resized = rgb.convert("RGB").resize(
            (BIREFNET_INPUT_SIZE, BIREFNET_INPUT_SIZE), Image.BICUBIC
        )
        x = np.asarray(resized, dtype=np.float32) / 255.0
        x = ((x - _IMAGENET_MEAN) / _IMAGENET_STD).transpose(2, 0, 1)[None]
        with self._lock:
            logits = self._session.run(None, {self._input_name: x.astype(np.float32)})[0][0, 0]
        prob = 1.0 / (1.0 + np.exp(-logits.astype(np.float32)))
        lo, hi = float(prob.min()), float(prob.max())
        if hi - lo < 1e-6:
            return np.zeros((height, width), dtype=np.float32)
        prob = (prob - lo) / (hi - lo)
        mask = Image.fromarray(np.clip(prob * 255.0, 0, 255).astype(np.uint8))
        return np.asarray(mask.resize((width, height), Image.BILINEAR), dtype=np.float32) / 255.0


def otsu_threshold(gray: np.ndarray) -> int:
    """Otsu's threshold for a uint8 array: the level that maximises the
    between-class variance of the two resulting classes."""
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 0
    levels = np.arange(256, dtype=np.float64)
    weight_bg = np.cumsum(hist)
    weight_fg = total - weight_bg
    cum_mean = np.cumsum(hist * levels)
    mean_total = cum_mean[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        mean_bg = cum_mean / weight_bg
        mean_fg = (mean_total - cum_mean) / weight_fg
        between = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
    between[~np.isfinite(between)] = -1.0
    return int(np.argmax(between))


def _has_usable_alpha(alpha: np.ndarray) -> bool:
    n = alpha.size
    transparent = np.count_nonzero(alpha < 13)
    opaque = np.count_nonzero(alpha > 242)
    floor = n * VALID_ALPHA_MIN_FRACTION
    return transparent >= floor and opaque >= floor


def _clean_mask(binary: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Drop sub-MIN_COMPONENT_PX blobs; return the cleaned mask and the
    (x, y, w, h) box of the largest remaining blob, which frames the crop."""
    from scipy import ndimage

    labels, count = ndimage.label(binary)
    if count == 0:
        raise ForegroundNotFound("no foreground subject found in the reference image")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    keep = sizes >= MIN_COMPONENT_PX
    if not keep.any():
        raise ForegroundNotFound("the reference image's subject is too small to reconstruct")
    cleaned = keep[labels]
    largest = int(np.argmax(sizes))
    ys, xs = np.nonzero(labels == largest)
    x0, y0 = int(xs.min()), int(ys.min())
    return cleaned, (x0, y0, int(xs.max()) - x0 + 1, int(ys.max()) - y0 + 1)


def prepare_reference_image(
    image: Image.Image,
    mask_fn: MaskFn,
    *,
    padding_ratio: float = DEFAULT_PADDING_RATIO,
    background: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """Return the subject composited on `background`, cropped to its bounding
    box and centred in a square with `padding_ratio` margin on the long side.

    A meaningful alpha channel on the input is used as-is (soft edges kept);
    otherwise `mask_fn` predicts one, which is binarised with Otsu and cleaned
    of small blobs before compositing."""
    image = ImageOps.exif_transpose(image)
    long_side = max(image.size)
    if long_side > MAX_SIDE:
        scale = MAX_SIDE / long_side
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    rgba = image.convert("RGBA")
    rgb = np.asarray(rgba, dtype=np.float32)[..., :3]
    supplied_alpha = np.asarray(rgba, dtype=np.uint8)[..., 3]

    if has_alpha and _has_usable_alpha(supplied_alpha):
        _, box = _clean_mask(supplied_alpha > 0)
        alpha = supplied_alpha.astype(np.float32) / 255.0
    else:
        soft = mask_fn(rgba.convert("RGB"))
        soft_u8 = np.clip(soft * 255.0, 0, 255).astype(np.uint8)
        if int(soft_u8.max()) == 0:
            raise ForegroundNotFound("no foreground subject found in the reference image")
        cleaned, box = _clean_mask(soft_u8 > otsu_threshold(soft_u8))
        alpha = cleaned.astype(np.float32)

    bg = np.array(background, dtype=np.float32)
    composite = rgb * alpha[..., None] + bg * (1.0 - alpha[..., None])

    x, y, w, h = box
    crop = composite[y:y + h, x:x + w]
    side = max(1, int(round(max(w, h) * (1.0 + 2.0 * padding_ratio))))
    canvas = np.empty((side, side, 3), dtype=np.float32)
    canvas[...] = bg
    oy, ox = (side - h) // 2, (side - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop
    return Image.fromarray(np.clip(canvas + 0.5, 0, 255).astype(np.uint8), "RGB")
