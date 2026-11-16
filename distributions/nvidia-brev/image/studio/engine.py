"""
TripoSR on the local NVIDIA GPU: one image in, one GLB out, with per-stage timings.

The model loads once per process (server.py holds the only Engine). Every stage
boundary calls torch.cuda.synchronize() before reading the clock, so a number
in the report is GPU work finished, not GPU work queued.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time

import numpy as np
import rembg
import torch
from PIL import Image

from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground, to_gradio_3d_orientation

from .core import FOREGROUND_RATIO, MATTE_FILL, InputError, TimingReport

log = logging.getLogger("three-ws.engine")

WEIGHTS_DIR = os.environ.get("TRIPOSR_WEIGHTS", "/opt/weights/triposr")
CHUNK_SIZE = int(os.environ.get("TRIPOSR_CHUNK_SIZE", "8192"))


def _sync() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


class Engine:
    def __init__(self) -> None:
        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA is not available inside the container. Start it with --gpus all "
                "on a host that has the NVIDIA driver and the NVIDIA Container Toolkit."
            )
        self.device = "cuda:0"
        self.gpu_name = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        self.gpu_memory_mb = int(props.total_memory / (1024 * 1024))
        self.compute_capability = f"{props.major}.{props.minor}"
        self._lock = threading.Lock()

        t0 = time.perf_counter()
        self.model = TSR.from_pretrained(WEIGHTS_DIR, config_name="config.yaml", weight_name="model.ckpt")
        self.model.renderer.set_chunk_size(CHUNK_SIZE)
        self.model.to(self.device)
        _sync()
        self.model_load_ms = round((time.perf_counter() - t0) * 1000, 1)

        t1 = time.perf_counter()
        self.matting = rembg.new_session("u2net")
        self.matting_load_ms = round((time.perf_counter() - t1) * 1000, 1)
        self.matting_providers = list(self.matting.inner_session.get_providers())
        log.info(
            "TripoSR on %s (%d MB, sm_%s) loaded in %.0f ms; U2-Net providers %s",
            self.gpu_name, self.gpu_memory_mb, self.compute_capability.replace(".", ""),
            self.model_load_ms, self.matting_providers,
        )

    def describe(self) -> dict:
        return {
            "gpu_name": self.gpu_name,
            "gpu_memory_mb": self.gpu_memory_mb,
            "compute_capability": self.compute_capability,
            "torch": torch.__version__,
            "cuda_runtime": torch.version.cuda,
            "model_load_ms": self.model_load_ms,
            "matting_load_ms": self.matting_load_ms,
            "matting_providers": self.matting_providers,
        }

    def _prepare(self, img: Image.Image) -> tuple[Image.Image, Image.Image]:
        """Upstream run.py preprocessing: matte, recenter, gray-fill, RGB."""
        source = img if img.mode in ("RGB", "RGBA") else img.convert("RGBA")
        matted = remove_background(source, self.matting).convert("RGBA")
        if matted.getextrema()[3][1] == 0:
            raise InputError(
                "no foreground subject was found in the image; use a photo or render "
                "of a single object against a plain background"
            )
        matted = resize_foreground(matted, FOREGROUND_RATIO)
        arr = np.asarray(matted).astype(np.float32) / 255.0
        rgb = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * MATTE_FILL
        prepared = Image.fromarray((rgb * 255.0).astype(np.uint8))
        return prepared, matted

    def generate(self, img: Image.Image, resolution: int) -> dict:
        """Run the full pipeline. Serialised: one GPU job at a time per process."""
        with self._lock:
            report = TimingReport()
            torch.cuda.reset_peak_memory_stats()

            _sync()
            t = time.perf_counter()
            prepared, _ = self._prepare(img)
            _sync()
            report.record("background_removal_ms", (time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            with torch.no_grad():
                scene_codes = self.model([prepared], device=self.device)
            _sync()
            report.record("model_forward_ms", (time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            with torch.no_grad():
                mesh = self.model.extract_mesh(scene_codes, True, resolution=resolution)[0]
            _sync()
            report.record("mesh_extraction_ms", (time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            mesh = to_gradio_3d_orientation(mesh)
            buf = io.BytesIO()
            mesh.export(buf, file_type="glb")
            glb = buf.getvalue()
            report.record("export_ms", (time.perf_counter() - t) * 1000)

            preview = io.BytesIO()
            prepared.save(preview, format="PNG")

            return {
                "glb": glb,
                "input_png": preview.getvalue(),
                "timings": report.as_dict(),
                "mesh": {
                    "vertices": int(len(mesh.vertices)),
                    "faces": int(len(mesh.faces)),
                    "bytes": len(glb),
                    "resolution": resolution,
                },
                "peak_gpu_memory_mb": int(torch.cuda.max_memory_allocated() / (1024 * 1024)),
            }
