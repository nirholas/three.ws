"""Solve camera poses for the rig dataset with pycolmap 4.2: SIFT, matching, rig-aware global mapping."""

import hashlib
import os
import shutil
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pycolmap

from .geometry import ViewCamera
from .progress import emit

GLOBAL_MIN_RATIO = 0.6
SEQUENTIAL_OVERLAP = 12
EXHAUSTIVE_MAX_IMAGES = 700
SIFT_MAX_FEATURES = 8192


def gpu_available() -> bool:
    return bool(getattr(pycolmap, "has_cuda", False))


def make_rig_config(rig: list[ViewCamera]) -> pycolmap.RigConfig:
    """One rig for the whole dataset: view 0 is the reference sensor and every other view sits at the same centre
    with a known relative rotation. Images are matched to sensors by the vNN/ folder prefix."""
    cameras = []
    ref_rot = rig[0].cam_from_pano
    zero = np.zeros((3, 1), dtype=np.float64)
    for cam in rig:
        pin = pycolmap.Camera.create_from_model_id(
            camera_id=0, model=pycolmap.CameraModelId.SIMPLE_PINHOLE, focal_length=cam.focal, width=cam.size, height=cam.size
        )
        pin.has_prior_focal_length = True
        if cam.index == 0:
            cam_from_rig = None
        else:
            cam_from_rig = pycolmap.Rigid3d(pycolmap.Rotation3d(cam.cam_from_pano @ ref_rot.T), zero)
        cameras.append(
            pycolmap.RigConfigCamera(ref_sensor=cam.index == 0, image_prefix=f"v{cam.index:02d}/", cam_from_rig=cam_from_rig, camera=pin)
        )
    return pycolmap.RigConfig(cameras=cameras)


def extract_features(db_path: Path, image_dir: Path, mask_dir: Path, rig: list[ViewCamera], threads: int, use_gpu: bool) -> None:
    emit("features", 0.0)
    cam = pycolmap.Camera.create_from_model_id(
        camera_id=0, model=pycolmap.CameraModelId.SIMPLE_PINHOLE, focal_length=rig[0].focal, width=rig[0].size, height=rig[0].size
    )
    extraction = pycolmap.FeatureExtractionOptions(use_gpu=use_gpu, num_threads=threads)
    extraction.sift.max_num_features = SIFT_MAX_FEATURES
    pycolmap.extract_features(
        db_path,
        image_dir,
        reader_options=pycolmap.ImageReaderOptions(mask_path=mask_dir, camera_model=cam.model_name, camera_params=cam.params_to_string()),
        camera_mode=pycolmap.CameraMode.PER_FOLDER,
        extraction_options=extraction,
        device=pycolmap.Device.auto if use_gpu else pycolmap.Device.cpu,
    )
    with pycolmap.Database.open(db_path) as db:
        pycolmap.apply_rig_config([make_rig_config(rig)], db)
    emit("features", 1.0)


VOCAB_TREE_NAME = "vocab_tree_faiss_flickr100K_words256K.bin"
VOCAB_TREE_SHA256 = "96ca8ec8ea60b1f73465aaf2c401fd3b3ca75cdba2d3c50d6a2f6f760f275ddc"
VOCAB_TREE_URL = "https://github.com/colmap/colmap/releases/download/3.11.1/" + VOCAB_TREE_NAME
VOCAB_DOWNLOAD_TIMEOUT_S = 60


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_vocab_tree(cache_dir: Path | None = None, url: str = VOCAB_TREE_URL) -> Path | None:
    """Find the loop-detection vocabulary tree without ever letting COLMAP download it.

    COLMAP aborts the whole process when its own download fails, so the file is resolved here: the
    PANO_SFM_VOCAB_TREE path, then a verified cached copy, then one verified download. None means loop
    detection must be skipped.
    """
    explicit = os.environ.get("PANO_SFM_VOCAB_TREE", "")
    if explicit:
        return Path(explicit) if Path(explicit).is_file() else None
    cache = cache_dir or Path(os.environ.get("PANO_SFM_CACHE", Path.home() / ".cache" / "pano_sfm"))
    target = cache / VOCAB_TREE_NAME
    if target.is_file() and _sha256(target) == VOCAB_TREE_SHA256:
        return target
    try:
        cache.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=VOCAB_DOWNLOAD_TIMEOUT_S) as resp, open(part, "wb") as out:
            shutil.copyfileobj(resp, out)
        if _sha256(part) != VOCAB_TREE_SHA256:
            part.unlink(missing_ok=True)
            return None
        part.replace(target)
        return target
    except (OSError, urllib.error.URLError):
        return None


def match(db_path: Path, kind: str, n_images: int, threads: int, use_gpu: bool) -> tuple[str, list[str]]:
    """Match image pairs. Video: sequential with loop detection. Photos: exhaustive, or vocab tree when large.

    Returns the matcher used and any warnings. Rig constraints verify pairs and views of one frame never pair up.
    """
    emit("matching", 0.0)
    warnings: list[str] = []
    opts = pycolmap.FeatureMatchingOptions(use_gpu=use_gpu, num_threads=threads)
    opts.rig_verification = True
    opts.skip_image_pairs_in_same_frame = True
    device = pycolmap.Device.auto if use_gpu else pycolmap.Device.cpu
    used = kind
    if kind == "sequential":
        pairing = pycolmap.SequentialPairingOptions(overlap=SEQUENTIAL_OVERLAP, expand_rig_images=True)
        vocab = resolve_vocab_tree()
        if vocab is not None:
            pairing.loop_detection = True
            pairing.loop_detection_period = 8
            pairing.vocab_tree_path = vocab
            used = "sequential+loops"
        else:
            pairing.loop_detection = False
            warnings.append("The loop-closure vocabulary tree was unavailable; matched neighbouring frames only.")
        pycolmap.match_sequential(db_path, pairing_options=pairing, matching_options=opts, device=device)
    elif kind == "exhaustive" and n_images <= EXHAUSTIVE_MAX_IMAGES:
        pycolmap.match_exhaustive(db_path, matching_options=opts, device=device)
    else:
        pycolmap.match_vocabtree(db_path, matching_options=opts, device=device)
        used = "vocabtree"
    emit("matching", 1.0)
    return used, warnings


@dataclass
class Solved:
    reconstruction: pycolmap.Reconstruction
    mapper: str
    ratio: float
    registered: int


def _best(recs: dict[int, pycolmap.Reconstruction]) -> pycolmap.Reconstruction | None:
    if not recs:
        return None
    return max(recs.values(), key=lambda r: r.num_reg_images())


def map_rig(db_path: Path, image_dir: Path, work: Path, total_images: int, threads: int, seed: int) -> tuple[Solved | None, list[str]]:
    """Rig-aware global mapper first; fall back to the incremental mapper when it registers under 60 percent."""
    emit("mapping", 0.0)
    warnings: list[str] = []
    candidates: list[Solved] = []

    global_dir = work / "sparse_global"
    global_dir.mkdir(parents=True, exist_ok=True)
    try:
        g_opts = pycolmap.GlobalPipelineOptions(
            num_threads=threads,
            random_seed=seed,
            mapper=pycolmap.GlobalMapperOptions(num_threads=threads, random_seed=seed, refine_sensor_from_rig=False),
        )
        g_opts.mapper.bundle_adjustment.refine_focal_length = False
        g_opts.mapper.bundle_adjustment.refine_principal_point = False
        g_opts.mapper.bundle_adjustment.refine_extra_params = False
        rec = _best(pycolmap.global_mapping(db_path, image_dir, global_dir, g_opts))
    except Exception as exc:
        rec = None
        warnings.append(f"Global mapper failed ({type(exc).__name__}); used the incremental mapper.")
    if rec is not None:
        candidates.append(Solved(rec, "global", rec.num_reg_images() / total_images, rec.num_reg_images()))
    emit("mapping", 0.5)

    if not candidates or candidates[0].ratio < GLOBAL_MIN_RATIO:
        inc_dir = work / "sparse_incremental"
        inc_dir.mkdir(parents=True, exist_ok=True)
        i_opts = pycolmap.IncrementalPipelineOptions(
            num_threads=threads,
            random_seed=seed,
            ba_refine_sensor_from_rig=False,
            ba_refine_focal_length=False,
            ba_refine_principal_point=False,
            ba_refine_extra_params=False,
        )
        rec = _best(pycolmap.incremental_mapping(db_path, image_dir, inc_dir, i_opts))
        if rec is not None:
            candidates.append(Solved(rec, "incremental", rec.num_reg_images() / total_images, rec.num_reg_images()))
        if candidates and len(candidates) == 2:
            warnings.append(f"Global mapper registered {candidates[0].ratio:.2f}; incremental mapper registered {candidates[1].ratio:.2f}.")
    emit("mapping", 1.0)
    if not candidates:
        return None, warnings
    return max(candidates, key=lambda s: s.registered), warnings


def clean_work(work: Path) -> None:
    shutil.rmtree(work, ignore_errors=True)
