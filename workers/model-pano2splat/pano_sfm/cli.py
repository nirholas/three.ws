"""Command line entry point: `python -m pano_sfm --input ... --out ... [flags]`. Contract C1."""

import argparse
import json
import sys
import traceback
from pathlib import Path

from .errors import EXIT_INTERNAL, PanoSfmError


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pano_sfm", description="Solve a COLMAP camera rig from 360 video or equirect photos.")
    p.add_argument("--input", required=True, type=Path, help="equirect .mp4/.mov or a folder of equirect .jpg/.png")
    p.add_argument("--out", required=True, type=Path, help="output COLMAP dataset directory")
    p.add_argument("--fps", type=float, default=2.0, help="frames sampled per second of video")
    p.add_argument("--max-frames", type=int, default=300)
    p.add_argument("--views", type=int, choices=(8, 12, 14), default=8)
    p.add_argument("--mask-operator", action="store_true", help="mask the person holding the camera and the selfie stick")
    p.add_argument("--mask-sky", action="store_true", help="mask sky")
    p.add_argument("--trim-start", type=float, default=0.0)
    p.add_argument("--trim-end", type=float, default=None)
    p.add_argument("--view-size", type=int, default=None, help="pixels per rig view side (default min(1600, width/4))")
    p.add_argument("--matcher", choices=("auto", "sequential", "exhaustive", "vocabtree"), default="auto")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--threads", type=int, default=-1)
    p.add_argument("--cpu", action="store_true", help="force CPU even when CUDA is present")
    return p


def _fail(code: str, message: str, exit_code: int) -> int:
    sys.stderr.write(json.dumps({"error": code, "message": message}) + "\n")
    sys.stderr.flush()
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        ns = parser.parse_args(argv)
    except SystemExit as exc:
        if exc.code in (0, None):
            return 0
        return _fail("bad_arguments", "The command line arguments were not valid. Run with --help for the list.", 2)

    from .pipeline import Options, run

    if ns.fps <= 0 or ns.max_frames < 1:
        return _fail("bad_arguments", "fps and max-frames must be positive.", 2)
    opts = Options(
        input=ns.input, out=ns.out, fps=ns.fps, max_frames=ns.max_frames, views=ns.views,
        mask_operator=ns.mask_operator, mask_sky=ns.mask_sky, trim_start=ns.trim_start, trim_end=ns.trim_end,
        view_size=ns.view_size, matcher=ns.matcher, seed=ns.seed, threads=ns.threads, cpu=ns.cpu,
    )
    try:
        run(opts)
    except PanoSfmError as exc:
        return _fail(exc.code, exc.message, exc.exit_code)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        return _fail("internal_error", f"Camera solving hit an unexpected problem ({type(exc).__name__}). Please try again.", EXIT_INTERNAL)
    return 0
