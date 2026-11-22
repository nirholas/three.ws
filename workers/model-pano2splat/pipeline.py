"""The pano2splat pipeline: download, stitch, frames plus SfM, train, export.

One implementation shared by the HTTP service (main.py) and the GPU job harness
(verify.py), so what the harness proves is what the service runs.
"""

from __future__ import annotations

import json
import shutil
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from source_fetch import ByteBudget, SourceError, download_source
from stages import Cancelled, StageError, StageRunner

PRESETS = {
    "preview": {"fps": 1, "max_frames": 120, "iterations": 7000, "max_gaussians": 3_000_000, "max_width": 3840},
    "standard": {"fps": 2, "max_frames": 300, "iterations": 30000, "max_gaussians": 3_000_000, "max_width": 7680},
    "high": {"fps": 3, "max_frames": 600, "iterations": 30000, "max_gaussians": 6_000_000, "max_width": 7680},
}

# Share of the task's progress bar per phase. Phases a task skips (no stitch for
# stitched input, no sfm or train for task "stitch") drop out and the rest are
# renormalised, so the bar always reaches 1.0.
WEIGHTS = {"download": 5.0, "stitch": 15.0, "sfm": 35.0, "train": 40.0, "export": 5.0}

STAGE_NAMES = ("download", "stitch", "frames", "sfm", "train", "export", "upload")

# Source kinds that carry a raw Insta360 file and therefore go through pano_stitch.
STITCHED_KINDS = ("insv", "insp")


class PipelineError(Exception):
    """A pipeline failure with a code and a visitor-readable message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PipelineRequest:
    task: str
    source_kind: str
    urls: list[str]
    quality: str = "standard"
    trim_start_s: Optional[float] = None
    trim_end_s: Optional[float] = None


@dataclass
class PipelineOutput:
    """Local files and stage statistics produced by one run."""

    files: dict[str, Path] = field(default_factory=dict)
    stats: dict[str, dict] = field(default_factory=dict)
    timings_s: dict[str, float] = field(default_factory=dict)


ProgressFn = Callable[[str, float], None]


def phases_for(req: PipelineRequest) -> list[str]:
    phases = ["download"]
    if req.source_kind in STITCHED_KINDS:
        phases.append("stitch")
    if req.task == "splat":
        phases += ["sfm", "train"]
    phases.append("export")
    return phases


class ProgressMap:
    """Maps per-phase fractions onto one monotonic 0..1 task progress."""

    def __init__(self, phases: list[str], report: ProgressFn):
        total = sum(WEIGHTS[p] for p in phases)
        self.start: dict[str, float] = {}
        self.span: dict[str, float] = {}
        acc = 0.0
        for p in phases:
            self.start[p] = acc / total
            self.span[p] = WEIGHTS[p] / total
            acc += WEIGHTS[p]
        self.report = report
        self.last = 0.0

    def update(self, phase: str, stage: str, frac: float) -> None:
        value = self.start[phase] + self.span[phase] * min(1.0, max(0.0, frac))
        self.last = max(self.last, value)
        self.report(stage, round(self.last, 4))

    def done(self, stage: str) -> None:
        self.last = 1.0
        self.report(stage, 1.0)


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def _require(path: Path, stage_module: str) -> Path:
    if not path.is_file():
        raise PipelineError(
            "internal_error",
            f"The {stage_module} stage finished without writing {path.name}.",
        )
    return path


def _sfm_stage_label(name: Optional[str]) -> str:
    return "frames" if name and "frame" in name.lower() else "sfm"


def run_pipeline(
    req: PipelineRequest,
    work: Path,
    report: ProgressFn,
    runner: StageRunner,
    budget: Optional[ByteBudget] = None,
    fetch: Callable[..., Path] = download_source,
) -> PipelineOutput:
    """Run the pipeline for ``req`` inside ``work``; raise PipelineError or Cancelled.

    ``fetch`` has the signature of ``download_source``; the service uses the SSRF-safe
    HTTP downloader and the verify harness swaps in a Cloud Storage reader.
    """
    out = PipelineOutput()
    preset = PRESETS[req.quality]
    progress = ProgressMap(phases_for(req), report)
    budget = budget or ByteBudget()
    work.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def timed(name: str):
        t0 = time.monotonic()
        try:
            yield
        finally:
            out.timings_s[name] = round(time.monotonic() - t0, 2)

    def guard(fn):
        try:
            return fn()
        except StageError as exc:
            raise PipelineError(exc.code, exc.message) from exc
        except SourceError as exc:
            if exc.code == "cancelled":
                raise Cancelled() from exc
            raise PipelineError(exc.code, exc.message) from exc

    # download
    src_dir = work / "source"
    src_dir.mkdir(exist_ok=True)
    files: list[Path] = []
    progress.update("download", "download", 0.0)
    with timed("download"):
        for i, url in enumerate(req.urls):
            path = guard(
                lambda url=url, i=i: fetch(
                    url, src_dir / f"{i:05d}", req.source_kind, budget, cancelled=lambda: runner.cancelled
                )
            )
            files.append(path)
            progress.update("download", "download", (i + 1) / len(req.urls))

    # stitch
    sfm_input: Path
    if req.source_kind in STITCHED_KINDS:
        stitch_out = work / "stitch"
        args = [
            "--input", ",".join(str(f) for f in files),
            "--out", str(stitch_out),
            "--level-horizon",
            "--max-width", str(preset["max_width"]),
        ]
        if req.source_kind == "insv":
            if req.trim_start_s is not None:
                args += ["--trim-start", str(req.trim_start_s)]
            if req.trim_end_s is not None:
                args += ["--trim-end", str(req.trim_end_s)]
            if req.task == "splat":
                # pano_sfm samples the equirect at the preset rate, so warping the
                # other frames only burns GPU time; a stitch task keeps them all.
                args += ["--fps", str(preset["fps"])]
        progress.update("stitch", "stitch", 0.0)
        with timed("stitch"):
            guard(lambda: runner.run("pano_stitch", args, lambda _s, f: progress.update("stitch", "stitch", f)))
        eq_name = "equirect.jpg" if req.source_kind == "insp" else "equirect.mp4"
        sfm_input = _require(stitch_out / eq_name, "pano_stitch")
        # The raw files can be gigabytes and Cloud Run's disk is memory: free it now.
        shutil.rmtree(src_dir, ignore_errors=True)
        out.files["equirect"] = sfm_input
        out.stats["stitch"] = _read_json(stitch_out / "stitch.json")
    elif req.source_kind == "equirect_video":
        sfm_input = files[0]
    else:
        sfm_input = src_dir

    if req.task == "stitch":
        progress.update("export", "export", 0.0)
        return out

    # frames plus SfM
    sfm_out = work / "sfm"
    args = ["--input", str(sfm_input), "--out", str(sfm_out), "--max-frames", str(preset["max_frames"]), "--mask-operator"]
    if req.source_kind != "equirect_images":
        args += ["--fps", str(preset["fps"])]
    if req.source_kind == "equirect_video":
        if req.trim_start_s is not None:
            args += ["--trim-start", str(req.trim_start_s)]
        if req.trim_end_s is not None:
            args += ["--trim-end", str(req.trim_end_s)]
    progress.update("sfm", "frames", 0.0)
    with timed("sfm"):
        guard(lambda: runner.run("pano_sfm", args, lambda s, f: progress.update("sfm", _sfm_stage_label(s), f)))
    out.stats["sfm"] = _read_json(sfm_out / "sfm.json")

    # train
    train_out = work / "train"
    args = [
        "--colmap", str(sfm_out),
        "--out", str(train_out),
        "--iterations", str(preset["iterations"]),
        "--max-gaussians", str(preset["max_gaussians"]),
        "--preview-video",
        "--holdout-every", "8",
    ]
    progress.update("train", "train", 0.0)
    with timed("train"):
        guard(lambda: runner.run("splat_train", args, lambda _s, f: progress.update("train", "train", f)))
    out.files["ply"] = _require(train_out / "scene.ply", "splat_train")
    out.files["spz"] = _require(train_out / "scene.spz", "splat_train")
    out.files["preview"] = _require(train_out / "preview.mp4", "splat_train")
    out.files["poster"] = _require(train_out / "poster.jpg", "splat_train")
    out.stats["train"] = _read_json(train_out / "train.json")
    progress.update("export", "export", 0.0)
    return out
