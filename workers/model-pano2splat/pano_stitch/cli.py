"""python -m pano_stitch: contract C1.

    python -m pano_stitch --input <file.insv[,file2.insv] | file.insp> --out <dir>
        [--level-horizon] [--max-width 7680] [--trim-start S] [--trim-end S]

Writes <out>/equirect.mp4 or <out>/equirect.jpg and <out>/stitch.json. Progress is one JSON
line per update on stdout ({stage, progress}). Exit codes: 0 done, 1 internal error,
2 unsupported input, 3 corrupt input; a failure ends stderr with one JSON line
{error, message}.
"""

import argparse
import json
import os
import sys

from .errors import EXIT_INTERNAL, EXIT_OK, StitchError, UnsupportedInput
from .layout import open_source, split_paths


def parse_args(argv):
    p = argparse.ArgumentParser(prog="pano_stitch", description="Stitch raw Insta360 .insv/.insp files into equirectangular video or photos.")
    p.add_argument("--input", required=True, help="a .insv or .insp file, or the two .insv files of a split pair separated by a comma")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--level-horizon", action="store_true", help="counter-rotate each frame with the IMU so the horizon stays level")
    p.add_argument("--max-width", type=int, default=7680, help="cap on the output width in pixels (default 7680)")
    p.add_argument("--trim-start", type=float, default=None, help="seconds to drop from the start")
    p.add_argument("--trim-end", type=float, default=None, help="seconds to drop from the end")
    p.add_argument("--fps", type=float, default=None, help="stitch only one frame per 1/FPS seconds (default: every frame); the output plays at FPS and has no audio")
    p.add_argument("--backend", choices=("auto", "cpu", "cuda"), default="auto", help="where the per frame warp runs")
    return p.parse_args(argv)


def fail(code, message, exit_code):
    sys.stderr.write(json.dumps({"error": code, "message": message}) + "\n")
    sys.stderr.flush()
    return exit_code


def run(argv):
    try:
        args = parse_args(argv)
    except SystemExit as exc:
        if exc.code in (0, None):
            return EXIT_OK
        return fail("bad_arguments", "The command line is invalid; run with --help for the options.", 2)
    try:
        if args.max_width < 256:
            raise UnsupportedInput("bad_arguments", "--max-width must be at least 256.")
        if args.fps is not None and not args.fps > 0:
            raise UnsupportedInput("bad_arguments", "--fps must be greater than zero.")
        os.makedirs(args.out, exist_ok=True)
        source = open_source(split_paths(args.input))
        if source.photo:
            from .photo import stitch_photo

            result = stitch_photo(source, args.out, args.max_width, args.level_horizon)
        else:
            from .video import emit_progress, stitch_video

            emit_progress("stitch", 0.0)
            result = stitch_video(source, args.out, args.max_width, args.level_horizon, args.trim_start, args.trim_end, args.backend, args.fps)
        from .report import build_report, write_report

        write_report(args.out, build_report(source, result))
        sys.stdout.write(json.dumps({"stage": "stitch", "progress": 1.0}) + "\n")
        return EXIT_OK
    except StitchError as exc:
        return fail(exc.code, exc.message, exc.exit_code)
    except Exception as exc:  # the CLI contract promises one JSON line on stderr for any failure
        return fail("internal_error", f"{type(exc).__name__}: {exc}", EXIT_INTERNAL)


def main():
    sys.exit(run(sys.argv[1:]))
