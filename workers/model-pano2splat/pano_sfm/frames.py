"""Frame selection: which equirect frames feed the solver.

Video: sample at --fps, reject blurry frames against the clip's own sharpness distribution, drop the
near-duplicates a stationary camera produces, and cap at --max-frames spread evenly over time.
Photo folders: every readable equirect image, ordered by EXIF capture time then file name.
"""

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .errors import PanoSfmError, corrupt, unsupported
from .progress import emit

PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png"}
ANALYSIS_W, ANALYSIS_H = 1024, 512
FLOW_W, FLOW_H = 256, 128
SHARPNESS_REL_THRESHOLD = 0.5
DUPLICATE_FLOW_PX = 0.35
MIN_KEPT_FRACTION = 0.5
EQUIRECT_TOLERANCE = 0.02


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration_s: float
    codec: str


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, check=False)


def probe_video(path: Path) -> VideoInfo:
    proc = _run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,avg_frame_rate,r_frame_rate,codec_name,duration:format=duration", "-of", "json", str(path)]
    )
    if proc.returncode != 0:
        raise corrupt("unreadable_video", "We couldn't read this video file. Check that it is a complete MP4 or MOV and upload it again.")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise corrupt("no_video_stream", "This file has no video track we can read.")
    s = streams[0]
    width, height = int(s["width"]), int(s["height"])
    rate = s.get("avg_frame_rate") or s.get("r_frame_rate") or "0/1"
    num, _, den = rate.partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    duration = float(s.get("duration") or (data.get("format") or {}).get("duration") or 0.0)
    if width <= 0 or height <= 0 or duration <= 0:
        raise corrupt("unreadable_video", "We couldn't read the size or length of this video.")
    return VideoInfo(width, height, fps, duration, s.get("codec_name", ""))


def require_equirect(width: int, height: int, what: str) -> None:
    if abs(width / height - 2.0) > EQUIRECT_TOLERANCE * 2.0:
        raise unsupported(
            "not_equirectangular",
            f"This {what} is {width} by {height}. We need a stitched 360 frame that is exactly twice as wide as it is tall.",
        )


def laplacian_sharpness(gray: np.ndarray) -> float:
    """Variance of the Laplacian over the equator band (the poles of an equirect are stretched and bias the score)."""
    h = gray.shape[0]
    band = gray[h // 4 : 3 * h // 4]
    return float(cv2.Laplacian(band, cv2.CV_64F).var())


def reject_blurry(sharpness: np.ndarray) -> np.ndarray:
    """Boolean keep mask: drop frames far below the clip's own median sharpness, but never most of the clip."""
    median = float(np.median(sharpness))
    keep = sharpness >= SHARPNESS_REL_THRESHOLD * median
    floor = int(np.ceil(MIN_KEPT_FRACTION * len(sharpness)))
    if keep.sum() < floor:
        order = np.argsort(-sharpness)[:floor]
        keep = np.zeros_like(keep)
        keep[order] = True
    return keep


def mean_flow_magnitude(a: np.ndarray, b: np.ndarray) -> float:
    flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    return float(np.linalg.norm(flow, axis=-1).mean())


def drop_duplicates(small: list[np.ndarray], candidates: list[int]) -> list[int]:
    """Walk the sharp candidates in time order, keeping one only once the view has moved since the last kept one."""
    kept: list[int] = []
    for idx in candidates:
        if not kept or mean_flow_magnitude(small[kept[-1]], small[idx]) >= DUPLICATE_FLOW_PX:
            kept.append(idx)
    return kept


def spread_evenly(times: np.ndarray, indices: list[int], cap: int) -> list[int]:
    """Pick at most cap indices whose timestamps are closest to evenly spaced targets over the kept range."""
    if len(indices) <= cap:
        return indices
    t = times[indices]
    targets = np.linspace(t[0], t[-1], cap)
    chosen = sorted({indices[int(np.argmin(np.abs(t - target)))] for target in targets})
    return chosen


def _analysis_pass(path: Path, fps: float, start: float, end: float | None) -> tuple[list[np.ndarray], np.ndarray, np.ndarray]:
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start}"]
    if end is not None:
        cmd += ["-to", f"{end}"]
    cmd += ["-i", str(path), "-an", "-vf", f"fps={fps},scale={ANALYSIS_W}:{ANALYSIS_H},format=gray", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = ANALYSIS_W * ANALYSIS_H
    sharp: list[float] = []
    small: list[np.ndarray] = []
    assert proc.stdout is not None
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        gray = np.frombuffer(buf, dtype=np.uint8).reshape(ANALYSIS_H, ANALYSIS_W)
        sharp.append(laplacian_sharpness(gray))
        small.append(cv2.resize(gray, (FLOW_W, FLOW_H), interpolation=cv2.INTER_AREA))
    stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    proc.wait()
    if not sharp:
        raise corrupt("no_frames_decoded", "We couldn't decode any frames from this video. Check the trim range and the file.")
    if proc.returncode not in (0, None) and len(sharp) < 2:
        raise corrupt("unreadable_video", f"This video stopped decoding early. {stderr.strip()[-120:]}")
    times = start + np.arange(len(sharp)) / fps
    return small, np.array(sharp), times


def _extract_chosen(path: Path, fps: float, start: float, end: float | None, chosen: list[int], width: int, height: int, out_dir: Path) -> None:
    """Decode once, sequentially, writing only the chosen sampled frames as 00000.jpg, 00001.jpg, ... in chosen order."""
    out_dir.mkdir(parents=True, exist_ok=True)
    script = out_dir.parent / "select.ffscript"
    expr = "+".join(f"eq(n\\,{i})" for i in chosen)
    script.write_text(f"fps={fps},select='{expr}',scale={width}:{height}:flags=lanczos")
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start}"]
    if end is not None:
        cmd += ["-to", f"{end}"]
    cmd += ["-i", str(path), "-an", "-filter_script:v", str(script), "-fps_mode", "passthrough", "-q:v", "2", "-start_number", "0", str(out_dir / "%05d.jpg")]
    proc = _run(cmd)
    written = len(list(out_dir.glob("*.jpg")))
    if proc.returncode != 0 or written == 0:
        raise corrupt("unreadable_video", "We couldn't pull the chosen frames out of this video.")
    if written != len(chosen):
        raise PanoSfmError("frame_extraction_mismatch", "Frame extraction returned an unexpected number of frames.", 1)
    script.unlink(missing_ok=True)


@dataclass(frozen=True)
class SelectedFrames:
    paths: list[Path]
    pano_width: int
    pano_height: int
    source_kind: str
    notes: dict


def select_video_frames(path: Path, work_dir: Path, fps: float, max_frames: int, trim_start: float, trim_end: float | None, view_size: int | None) -> SelectedFrames:
    info = probe_video(path)
    require_equirect(info.width, info.height, "video")
    if trim_end is not None and trim_end <= trim_start:
        raise unsupported("bad_trim", "The trim end has to be after the trim start.")
    end = None if trim_end is None else min(trim_end, info.duration_s)
    if trim_start >= info.duration_s:
        raise unsupported("bad_trim", "The trim start is after the end of the video.")
    emit("frames", 0.0)
    small, sharp, times = _analysis_pass(path, fps, trim_start, end)
    emit("frames", 0.4)
    sharp_keep = reject_blurry(sharp)
    candidates = [i for i in range(len(sharp)) if sharp_keep[i]]
    moving = drop_duplicates(small, candidates)
    chosen = spread_evenly(times, moving, max_frames)
    emit("frames", 0.6)
    size = view_size or min(1600, (info.width // 4) // 2 * 2)
    pano_w, pano_h = size * 4, size * 2
    _extract_chosen(path, fps, trim_start, end, chosen, pano_w, pano_h, work_dir / "panos")
    emit("frames", 1.0)
    notes = {
        "sampled": len(sharp),
        "rejected_blurry": int(len(sharp) - int(sharp_keep.sum())),
        "dropped_duplicate": len(candidates) - len(moving),
        "source_fps": info.fps,
        "source_width": info.width,
        "source_height": info.height,
        "source_codec": info.codec,
    }
    return SelectedFrames(sorted((work_dir / "panos").glob("*.jpg")), pano_w, pano_h, "video", notes)


def _exif_time(path: Path) -> str:
    if path.suffix.lower() not in {".jpg", ".jpeg"}:
        return ""
    try:
        from PIL import Image

        exif = Image.open(path).getexif()
        sub = exif.get_ifd(0x8769)
        value = sub.get(0x9003) or exif.get(0x0132) or ""
        return str(value)
    except OSError:
        return ""


def _natural_key(p: Path) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def select_photo_frames(directory: Path, work_dir: Path, max_frames: int, view_size: int | None) -> SelectedFrames:
    files = [p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in PHOTO_SUFFIXES]
    if not files:
        raise corrupt("no_images", "We found no JPG or PNG photos in this set.")
    files.sort(key=lambda p: (_exif_time(p) or "~", _natural_key(p)))
    emit("frames", 0.0)
    images: list[tuple[Path, int, int]] = []
    for p in files:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            raise corrupt("unreadable_image", f"We couldn't read the photo {p.name}. Remove it or re-export it and try again.")
        h, w = img.shape[:2]
        require_equirect(w, h, f"photo {p.name}")
        images.append((p, w, h))
    widths = {w for _, w, _ in images}
    if len(widths) != 1:
        raise unsupported("mixed_photo_sizes", "All photos in the set need to be the same size.")
    if len(images) > max_frames:
        picks = np.linspace(0, len(images) - 1, max_frames).round().astype(int)
        images = [images[i] for i in sorted(set(picks.tolist()))]
    src_w = images[0][1]
    size = view_size or min(1600, (src_w // 4) // 2 * 2)
    pano_w, pano_h = size * 4, size * 2
    out = work_dir / "panos"
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, (p, _, _) in enumerate(images):
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img.shape[1] != pano_w:
            interp = cv2.INTER_AREA if img.shape[1] > pano_w else cv2.INTER_CUBIC
            img = cv2.resize(img, (pano_w, pano_h), interpolation=interp)
        dest = out / f"{i:05d}.jpg"
        cv2.imwrite(str(dest), img, [cv2.IMWRITE_JPEG_QUALITY, 97])
        paths.append(dest)
        emit("frames", (i + 1) / len(images))
    return SelectedFrames(paths, pano_w, pano_h, "images", {"source_width": src_w, "photos": len(files)})
