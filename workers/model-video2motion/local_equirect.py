#!/usr/bin/env python3
"""Local driver: 360 video -> reframe.mp4 + subject_track + clip.json, no server, no GCS.

    python local_equirect.py <equirect.mp4> <out_dir> [--fps=24] [--seconds=12]
                             [--yaw=DEG --pitch=DEG]

Runs the SAME code as main._process for projection "equirect" (main._reframe_equirect,
_normalize_video, _analyze, compensate_camera_rotation, landmarks_to_clip) and
writes the reframe, the track and the stats next to the clip. Models are read
from $MODELS_DIR (default ./.models).
"""
import json
import os
import sys
import time

os.environ.setdefault("API_KEY", "local")
os.environ.setdefault("GCS_BUCKET", "local")
os.environ.setdefault("MODELS_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".models"))

import main  # noqa: E402
import equirect  # noqa: E402
from pose_solver import landmarks_to_clip  # noqa: E402


def _arg(name, default):
    for a in sys.argv[3:]:
        if a.startswith(f"--{name}="):
            return float(a.split("=", 1)[1])
    return default


def run(src, out_dir, fps, seconds, subject):
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    reframe, track, stats = main._reframe_equirect(src, out_dir, fps, seconds, subject)
    norm = os.path.join(out_dir, "video.mp4")
    main._normalize_video(reframe, norm, fps, seconds)
    world, image, vis, hands, masks, width, height = main._analyze(norm, fps)
    world = equirect.compensate_camera_rotation(world, track.yaw_deg, track.pitch_deg)
    hands = equirect.compensate_camera_rotation(hands, track.yaw_deg, track.pitch_deg)
    clip = landmarks_to_clip(world, fps=fps, name="local-equirect", hands=hands)
    with open(os.path.join(out_dir, "clip.json"), "w") as f:
        json.dump(clip, f)
    entries = track.entries(fps)
    with open(os.path.join(out_dir, "subject_track.json"), "w") as f:
        json.dump(entries, f)
    stats = dict(stats, pose_frames=int(world.shape[0]), total_seconds=round(time.time() - t0, 2))
    with open(os.path.join(out_dir, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1)
    print(json.dumps(stats))
    return entries, stats


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    yaw, pitch = _arg("yaw", None), _arg("pitch", 0.0)
    run(
        sys.argv[1],
        sys.argv[2],
        int(_arg("fps", 24)),
        _arg("seconds", 12),
        (yaw, pitch) if yaw is not None else None,
    )
