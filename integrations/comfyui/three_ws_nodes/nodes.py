"""three.ws Forge nodes for ComfyUI.

Two nodes drive the public three.ws Forge pipeline:

* **three.ws Text→3D**  — prompt → GLB path
* **three.ws Image→3D** — IMAGE → GLB path

Each submits a real generation job, polls to completion, and downloads the GLB
into ComfyUI's output directory. The ``glb_path`` STRING output can feed any 3D
node (e.g. ComfyUI-3D-Pack viewers/savers). Making a model needs a free three.ws
account: set the ``THREE_WS_API_KEY`` environment variable before starting
ComfyUI (recommended), or fill the optional ``api_key`` input. The image pipeline
(FLUX→TRELLIS) needs nothing more; the geometry pipeline (Meshy/Tripo) also uses
your own provider key.

Caching: ComfyUI re-runs a node only when its inputs change, so an identical
prompt+settings returns the cached GLB instead of re-generating. Change any
input (or the ``label``) to force a fresh run.
"""

import hashlib
import io
import os

from .three_ws_client import BACKENDS, DEFAULT_BASE_URL, PATHS, TIERS, ThreeWSClient, ThreeWSError

_TIER_ITEMS = list(TIERS)
_PATH_ITEMS = list(PATHS)
_BACKEND_ITEMS = ["auto"] + list(BACKENDS)
_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16"]


def _output_dir():
    """ComfyUI output dir when running inside ComfyUI, else a temp dir."""
    try:
        import folder_paths  # provided by ComfyUI at runtime
        return folder_paths.get_output_directory()
    except Exception:
        import tempfile
        d = os.path.join(tempfile.gettempdir(), "three-ws")
        os.makedirs(d, exist_ok=True)
        return d


def _progress_reporter():
    """Return a callable(status, elapsed) wired to ComfyUI's progress bar if present."""
    try:
        from comfy.utils import ProgressBar
        bar = ProgressBar(100)
        seen = {"v": 0}

        def report(status, elapsed):
            # No real percentage from the job; nudge the bar so the UI shows life.
            seen["v"] = min(95, seen["v"] + 3)
            bar.update_absolute(seen["v"])
        return report
    except Exception:
        return lambda status, elapsed: None


# A widget value is saved into the workflow, and ComfyUI embeds the workflow in
# every PNG it writes, so the environment variable is the safer home for a key.
_API_KEY_INPUT = (
    "STRING",
    {
        "default": "",
        "tooltip": "three.ws API key from three.ws/dashboard/api-keys. Making a model "
        "needs a free account. Leave blank to use the THREE_WS_API_KEY environment "
        "variable, which keeps the key out of saved workflows and output images.",
    },
)


def _client(api_url, provider_key, api_key=""):
    return ThreeWSClient(
        (api_url or DEFAULT_BASE_URL).strip(),
        provider_key=(provider_key or "").strip() or None,
        api_key=(api_key or "").strip() or None,
    )


def _dest(prefix, key_material):
    digest = hashlib.sha256(key_material.encode("utf-8")).hexdigest()[:16]
    return os.path.join(_output_dir(), f"{prefix}-{digest}.glb")


class ThreeWSTextTo3D:
    """Generate a 3D model from a text prompt via three.ws Forge."""

    CATEGORY = "three.ws"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("glb_path", "status")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "a brass steampunk owl"}),
                "tier": (_TIER_ITEMS, {"default": "standard"}),
                "pipeline": (_PATH_ITEMS, {"default": "image"}),
                "backend": (_BACKEND_ITEMS, {"default": "auto"}),
                "aspect_ratio": (_ASPECTS, {"default": "1:1"}),
            },
            "optional": {
                "api_url": ("STRING", {"default": DEFAULT_BASE_URL}),
                "provider_key": ("STRING", {"default": ""}),
                "api_key": _API_KEY_INPUT,
            },
        }

    def generate(self, prompt, tier, pipeline, backend, aspect_ratio, api_url="", provider_key="", api_key=""):
        client = _client(api_url, provider_key, api_key)
        dest = _dest("text3d", f"{prompt}|{tier}|{pipeline}|{backend}|{aspect_ratio}|{api_url}")
        if os.path.isfile(dest):
            return (dest, "cached")
        try:
            glb_url = client.generate_text_to_3d(
                prompt, tier=tier, path=pipeline,
                backend=None if backend == "auto" else backend,
                aspect_ratio=aspect_ratio, on_progress=_progress_reporter(),
            )
            client.download(glb_url, dest)
        except ThreeWSError as exc:
            raise RuntimeError(f"three.ws Forge: {exc.message}") from exc
        return (dest, "done")


class ThreeWSImageTo3D:
    """Generate a 3D model from a reference image via three.ws Forge."""

    CATEGORY = "three.ws"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("glb_path", "status")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "tier": (_TIER_ITEMS, {"default": "standard"}),
                "pipeline": (_PATH_ITEMS, {"default": "image"}),
                "backend": (_BACKEND_ITEMS, {"default": "auto"}),
            },
            "optional": {
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "api_url": ("STRING", {"default": DEFAULT_BASE_URL}),
                "provider_key": ("STRING", {"default": ""}),
                "api_key": _API_KEY_INPUT,
            },
        }

    def generate(self, image, tier, pipeline, backend, prompt="", api_url="", provider_key="", api_key=""):
        png_bytes = _image_tensor_to_png(image)
        client = _client(api_url, provider_key, api_key)
        key = hashlib.sha256(png_bytes).hexdigest()[:12]
        dest = _dest("image3d", f"{key}|{prompt}|{tier}|{pipeline}|{backend}|{api_url}")
        if os.path.isfile(dest):
            return (dest, "cached")
        try:
            glb_url = client.generate_image_to_3d(
                png_bytes, "image/png", prompt=prompt, tier=tier, path=pipeline,
                backend=None if backend == "auto" else backend, on_progress=_progress_reporter(),
            )
            client.download(glb_url, dest)
        except ThreeWSError as exc:
            raise RuntimeError(f"three.ws Forge: {exc.message}") from exc
        return (dest, "done")


def _image_tensor_to_png(image) -> bytes:
    """ComfyUI IMAGE tensor (B,H,W,C float 0..1) → PNG bytes of the first frame."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - ComfyUI always ships these
        raise RuntimeError("three.ws Image→3D needs numpy + Pillow.") from exc

    arr = image
    # Torch tensor or numpy array — normalize to a numpy HWC uint8 frame.
    if hasattr(arr, "cpu"):
        arr = arr.cpu().numpy()
    arr = np.asarray(arr)
    if arr.ndim == 4:
        arr = arr[0]
    arr = np.clip(arr * 255.0, 0, 255).astype("uint8")
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


NODE_CLASS_MAPPINGS = {
    "ThreeWSTextTo3D": ThreeWSTextTo3D,
    "ThreeWSImageTo3D": ThreeWSImageTo3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ThreeWSTextTo3D": "three.ws Text→3D",
    "ThreeWSImageTo3D": "three.ws Image→3D",
}
