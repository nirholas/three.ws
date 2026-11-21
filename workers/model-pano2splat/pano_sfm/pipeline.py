"""End to end: frames -> rig views (+ masks) -> SIFT and matching -> rig global mapper -> gravity -> COLMAP dataset."""

import json
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import frames as frame_stage
from . import gravity, solve
from .errors import PanoSfmError, corrupt, quality, unsupported
from .geometry import ViewCamera, build_rig, view_name, voronoi_owner
from .masks import LOW_H, LOW_W, OperatorMasker, PersonSegmenter, sky_mask, view_keep_mask
from .progress import emit

MIN_REGISTRATION = 0.6
TOO_FEW_MESSAGE = (
    "We couldn't work out where the camera was in enough of this video. "
    "Walk slower, keep the camera on a stick above your head, and avoid blank walls."
)
MIN_FRAMES = 6


@dataclass
class Options:
    input: Path
    out: Path
    fps: float = 2.0
    max_frames: int = 300
    views: int = 8
    mask_operator: bool = False
    mask_sky: bool = False
    trim_start: float = 0.0
    trim_end: float | None = None
    view_size: int | None = None
    matcher: str = "auto"
    seed: int = 0
    threads: int = -1
    cpu: bool = False


def _threads(opts: Options) -> int:
    return opts.threads if opts.threads > 0 else (os.cpu_count() or 4)


def _render_pass(opts: Options, panos: list[Path], rig: list[ViewCamera], work: Path, out: Path) -> None:
    """Split every frame into rig views, write feature-extraction masks and, when asked, training masks."""
    size = rig[0].size
    uv_maps = [cam.pano_uv_map() for cam in rig]
    owners = voronoi_owner(rig)
    map_x = [(uv[..., 0] * size * 4 - 0.5).astype(np.float32) for uv in uv_maps]
    map_y = [(uv[..., 1] * size * 2 - 0.5).astype(np.float32) for uv in uv_maps]
    masking = opts.mask_operator or opts.mask_sky
    masker = OperatorMasker(PersonSegmenter()) if opts.mask_operator else None
    for cam in rig:
        (work / "rig" / f"v{cam.index:02d}").mkdir(parents=True, exist_ok=True)
        (work / "masks" / f"v{cam.index:02d}").mkdir(parents=True, exist_ok=True)
    if masking:
        (out / "masks").mkdir(parents=True, exist_ok=True)

    done = [0]
    stage = "masks" if masking else "views"

    def one(frame_index: int) -> None:
        pano = cv2.imread(str(panos[frame_index]), cv2.IMREAD_COLOR)
        if pano is None:
            raise corrupt("unreadable_frame", "A selected frame could not be read back.")
        exclude = None
        if masking:
            low = cv2.resize(pano, (LOW_W, LOW_H), interpolation=cv2.INTER_AREA)
            exclude = np.zeros((LOW_H, LOW_W), dtype=bool)
            if masker is not None:
                exclude |= masker.operator_mask(low)
            if opts.mask_sky:
                exclude |= sky_mask(low)
        for cam in rig:
            i = cam.index
            view = cv2.remap(pano, map_x[i], map_y[i], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            cv2.imwrite(str(work / "rig" / f"v{i:02d}" / f"{frame_index:05d}.jpg"), view, [cv2.IMWRITE_JPEG_QUALITY, 95])
            keep = view_keep_mask(exclude, uv_maps[i], size)
            if keep is not None:
                cv2.imwrite(str(out / "masks" / f"{view_name(frame_index, i)}.png"), keep)
            feature_mask = owners[i] if keep is None else (owners[i] & (keep > 0))
            cv2.imwrite(str(work / "masks" / f"v{i:02d}" / f"{frame_index:05d}.jpg.png"), feature_mask.astype(np.uint8) * 255)
        done[0] += 1
        emit(stage, done[0] / len(panos))

    emit(stage, 0.0)
    workers = 2 if masker is not None else max(1, min(12, (os.cpu_count() or 2) - 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in [pool.submit(one, i) for i in range(len(panos))]:
            fut.result()


def _frame_of(image_name: str) -> int:
    return int(Path(image_name).stem)


def _view_of(image_name: str) -> int:
    return int(Path(image_name).parent.name[1:])


def _gravity_inputs(rec, rig: list[ViewCamera], work: Path):
    """Frame rotations and a sample of horizon-view images with their solved camera rotations."""
    horizon = [c for c in rig if c.pitch_deg == 0.0]
    frame_rots: dict[int, np.ndarray] = {}
    per_frame_views: dict[int, list[tuple[str, np.ndarray]]] = {}
    for image in rec.images.values():
        if not image.has_pose:
            continue
        f = _frame_of(image.name)
        v = _view_of(image.name)
        cfw = image.cam_from_world().rotation.matrix() if callable(image.cam_from_world) else image.cam_from_world.rotation.matrix()
        if v == 0:
            frame_rots[f] = cfw
        if any(c.index == v for c in horizon):
            per_frame_views.setdefault(f, []).append((image.name, cfw))
    frames = sorted(per_frame_views)
    picks = np.linspace(0, len(frames) - 1, min(gravity.MAX_FRAMES_FOR_LINES, len(frames))).round().astype(int) if frames else []
    sampled = []
    for k in sorted(set(int(p) for p in picks)):
        f = frames[k]
        for name, cfw in per_frame_views[f][::2]:
            img = cv2.imread(str(work / "rig" / name))
            if img is not None:
                sampled.append((img, cfw, rig[0].focal, rig[0].principal))
    return [frame_rots[f] for f in sorted(frame_rots)], sampled


def _finalize(rec, rig: list[ViewCamera], work: Path, out: Path, opts: Options, leveled: bool | None, warnings: list[str]) -> dict:
    import pycolmap

    emit("gravity", 0.0)
    rots, sampled = _gravity_inputs(rec, rig, work)
    result = gravity.estimate_up(leveled, rots, sampled, opts.seed)
    if result.warning:
        warnings.append(result.warning)
    rot = gravity.rotation_between(result.up_world, np.array([0.0, 1.0, 0.0]))
    rec.transform(pycolmap.Sim3d(1.0, pycolmap.Rotation3d(rot), np.zeros((3, 1))))
    emit("gravity", 1.0)

    emit("export", 0.0)
    images_dir = out / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    for image in rec.images.values():
        f, v = _frame_of(image.name), _view_of(image.name)
        new_name = view_name(f, v)
        src = work / "rig" / image.name
        if src.exists():
            shutil.move(str(src), str(images_dir / new_name))
        image.name = new_name
    sparse = out / "sparse" / "0"
    if sparse.exists():
        shutil.rmtree(sparse)
    sparse.mkdir(parents=True)
    rec.write(sparse)
    emit("export", 0.5)
    all_names = {i.name for i in rec.images.values()}
    for img in images_dir.glob("*.jpg"):
        if img.name not in all_names:
            img.unlink()
    mask_dir = out / "masks"
    if mask_dir.exists():
        for m in mask_dir.glob("*.png"):
            if m.name[:-4] not in all_names:
                m.unlink()
    emit("export", 1.0)
    return {"gravity": {"method": result.method, "inliers": result.inliers, "up_world_before": [round(float(x), 5) for x in result.up_world]}}


def run(opts: Options) -> dict:
    import pycolmap

    started = time.time()
    warnings: list[str] = []
    if opts.views not in (8, 12, 14):
        raise unsupported("bad_views", "The number of views must be 8, 12 or 14.")
    if not opts.input.exists():
        raise corrupt("input_missing", "We couldn't find the input to solve.")
    out = opts.out
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    use_gpu = solve.gpu_available() and not opts.cpu
    threads = _threads(opts)

    if opts.input.is_dir():
        selected = frame_stage.select_photo_frames(opts.input, work, opts.max_frames, opts.view_size)
        kind = "exhaustive"
    elif opts.input.suffix.lower() in frame_stage.PHOTO_SUFFIXES:
        raise unsupported("single_image", "One photo is not enough to work out camera positions. Give us a video or a folder of 360 photos.")
    else:
        selected = frame_stage.select_video_frames(opts.input, work, opts.fps, opts.max_frames, opts.trim_start, opts.trim_end, opts.view_size)
        kind = "sequential"
    if opts.matcher != "auto":
        kind = opts.matcher
    if len(selected.paths) < MIN_FRAMES:
        raise quality("too_few_frames", "We found too few sharp, distinct frames. Move the camera more during the shot, or give us more photos.")

    size = selected.pano_height // 2
    rig = build_rig(opts.views, size)
    total_images = len(selected.paths) * len(rig)

    _render_pass(opts, selected.paths, rig, work, out)
    leveled = gravity.read_horizon_leveled(opts.input)

    db_path = work / "database.db"
    solve.extract_features(db_path, work / "rig", work / "masks", rig, threads, use_gpu)
    matcher, match_warnings = solve.match(db_path, kind, total_images, threads, use_gpu)
    warnings += match_warnings
    solved, map_warnings = solve.map_rig(db_path, work / "rig", work, total_images, threads, opts.seed)
    warnings += map_warnings

    if solved is None or solved.ratio < MIN_REGISTRATION:
        raise quality("too_few_registered", TOO_FEW_MESSAGE)

    rec = solved.reconstruction
    final = _finalize(rec, rig, work, out, opts, leveled, warnings)
    stats = {
        "frames_used": len(selected.paths),
        "views_per_frame": len(rig),
        "registered_images": solved.registered,
        "total_images": total_images,
        "registration_ratio": round(solved.ratio, 4),
        "mean_reproj_error_px": round(float(rec.compute_mean_reprojection_error()), 4),
        "points3d": int(rec.num_points3D()),
        "duration_s": round(time.time() - started, 1),
        "warnings": warnings,
        "mapper": solved.mapper,
        "matcher": matcher,
        "source_kind": selected.source_kind,
        "frame_selection": selected.notes,
        "gravity": final["gravity"],
        "view_size_px": size,
        "colmap_version": pycolmap.__version__,
        "gpu": use_gpu,
        "masks": {"operator": opts.mask_operator, "sky": opts.mask_sky},
    }
    (out / "sfm.json").write_text(json.dumps(stats, indent=2))
    solve.clean_work(work)
    return stats
