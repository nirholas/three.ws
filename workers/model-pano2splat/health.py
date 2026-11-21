"""/health: what this worker can actually do, measured rather than assumed."""

from __future__ import annotations

import importlib.metadata
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Optional

import stages
from stages import stage_env, stage_installed

STAGE_MODULES = ("pano_stitch", "pano_sfm", "splat_train")
CACHE_TTL_S = 300.0

_lock = threading.Lock()
_cache: dict = {}


def _run(cmd: list[str], timeout: float = 20.0) -> Optional[str]:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return (res.stdout or "") + (res.stderr or "")


def gpu_available() -> bool:
    if shutil.which("nvidia-smi"):
        out = _run(["nvidia-smi", "-L"], timeout=10)
        if out and "GPU" in out:
            return True
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001 - torch absent or broken means no GPU for our purposes
        return False


def colmap_version() -> Optional[str]:
    if not shutil.which("colmap"):
        return None
    out = _run(["colmap", "help"])
    match = re.search(r"COLMAP\s+(\d+\.\d+(?:\.\d+)?)", out or "")
    return match.group(1) if match else None


def gsplat_version() -> Optional[str]:
    code = "import importlib.metadata as m; print(m.version('gsplat'))"
    try:
        out = subprocess.run(
            [stages.stage_python("splat_train"), "-c", code],
            capture_output=True, text=True, timeout=30, env=stage_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def ffmpeg_info() -> dict:
    if not shutil.which("ffmpeg"):
        return {"present": False, "nvenc": False}
    out = _run(["ffmpeg", "-hide_banner", "-encoders"]) or ""
    return {"present": True, "nvenc": "h264_nvenc" in out and "hevc_nvenc" in out}


def stage_status() -> dict:
    """Per stage: is the package on disk, and does it import in a clean interpreter."""
    status = {}
    for module in STAGE_MODULES:
        if not stage_installed(module):
            status[module] = {"present": False, "imports": False}
            continue
        res = subprocess.run(
            [stages.stage_python(module), "-c", f"import {module}"],
            capture_output=True, text=True, timeout=120, env=stage_env(), cwd=str(stages.STAGES_DIR),
        )
        entry = {"present": True, "imports": res.returncode == 0}
        if res.returncode != 0:
            entry["error"] = (res.stderr.strip().splitlines() or ["import failed"])[-1][:300]
        status[module] = entry
    return status


def report(max_source_bytes: int) -> dict:
    with _lock:
        fresh = _cache.get("at", 0) > time.time() - CACHE_TTL_S
        if not fresh:
            _cache["stages"] = stage_status()
            _cache["colmap"] = colmap_version()
            _cache["gsplat"] = gsplat_version()
            _cache["ffmpeg"] = ffmpeg_info()
            _cache["at"] = time.time()
        stages = _cache["stages"]
        colmap, gsplat, ffmpeg = _cache["colmap"], _cache["gsplat"], _cache["ffmpeg"]
    return {
        "ok": True,
        "gpu_available": gpu_available(),
        "colmap_version": colmap,
        "gsplat_version": gsplat,
        "ffmpeg": ffmpeg,
        "stages": stages,
        "max_source_bytes": max_source_bytes,
    }
