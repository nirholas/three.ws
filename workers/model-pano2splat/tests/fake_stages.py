"""Contract-speaking stand-ins for the three stage CLIs, written to a temp dir.

Each fake honours the C1 CLI contract: the documented flags, JSON-line progress
on stdout, output files in the documented layout, exit codes, and a one-line
JSON error on stderr. Behaviour is switched with FAKE_<MODULE>=<mode>.
"""

from pathlib import Path

COMMON = r'''
import json, os, sys, time, argparse
from pathlib import Path

MODULE = "{module}"
mode = os.environ.get("FAKE_" + MODULE.upper(), "ok")
log = os.environ.get("FAKE_LOG")
if log:
    with open(log, "a") as fh:
        fh.write(json.dumps({{"module": MODULE, "argv": sys.argv[1:]}}) + "\n")

def progress(stage, p):
    print(json.dumps({{"stage": stage, "progress": p}}), flush=True)

def fail(code, error, message):
    print(json.dumps({{"error": error, "message": message}}), file=sys.stderr, flush=True)
    sys.exit(code)

if mode.startswith("exit"):
    _, code, error = mode.split(":")
    fail(int(code), error, "Fake failure " + error + ".")
if mode == "hang":
    import subprocess
    child = subprocess.Popen(["sleep", "300"])
    Path(os.environ["FAKE_PIDFILE"]).write_text(str(child.pid))
    progress("working", 0.1)
    time.sleep(300)
if mode == "slow":
    progress("working", 0.1)
    time.sleep(float(os.environ.get("FAKE_SLOW_S", "1.5")))

{body}
'''

STITCH = '''
ap = argparse.ArgumentParser()
ap.add_argument("--input", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--level-horizon", action="store_true")
ap.add_argument("--max-width", type=int, default=7680)
ap.add_argument("--trim-start", type=float)
ap.add_argument("--trim-end", type=float)
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
progress("stitch", 0.5)
if a.input.endswith(".insp"):
    (out / "equirect.jpg").write_bytes(b"\\xff\\xd8\\xff" + b"0" * 64)
else:
    (out / "equirect.mp4").write_bytes(b"\\x00\\x00\\x00\\x18ftypisom" + b"0" * 64)
(out / "stitch.json").write_text(json.dumps({"camera_model": "X5", "width": a.max_width, "height": a.max_width // 2, "warnings": []}))
progress("stitch", 1.0)
'''

SFM = '''
ap = argparse.ArgumentParser()
ap.add_argument("--input", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--fps", type=float)
ap.add_argument("--max-frames", type=int)
ap.add_argument("--views", type=int)
ap.add_argument("--mask-operator", action="store_true")
ap.add_argument("--mask-sky", action="store_true")
ap.add_argument("--trim-start", type=float)
ap.add_argument("--trim-end", type=float)
a = ap.parse_args()
if not Path(a.input).exists():
    fail(3, "input_missing", "Input missing.")
out = Path(a.out); (out / "sparse" / "0").mkdir(parents=True, exist_ok=True)
progress("frames", 0.5)
progress("sfm", 0.5)
(out / "sfm.json").write_text(json.dumps({"frames_used": 10, "registration_ratio": 0.95, "warnings": []}))
progress("sfm", 1.0)
'''

TRAIN = '''
ap = argparse.ArgumentParser()
ap.add_argument("--colmap", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--iterations", type=int, default=30000)
ap.add_argument("--max-gaussians", type=int, default=3000000)
ap.add_argument("--preview-video", action="store_true")
ap.add_argument("--holdout-every", type=int, default=8)
a = ap.parse_args()
if not (Path(a.colmap) / "sparse" / "0").is_dir():
    fail(3, "colmap_missing", "No COLMAP model.")
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
progress("train", 0.5)
(out / "scene.ply").write_bytes(b"ply\\n" + b"0" * 64)
(out / "scene.spz").write_bytes(b"spz" + b"0" * 64)
(out / "preview.mp4").write_bytes(b"\\x00\\x00\\x00\\x18ftypisom" + b"0" * 64)
(out / "poster.jpg").write_bytes(b"\\xff\\xd8\\xff" + b"0" * 64)
(out / "train.json").write_text(json.dumps({"iterations": a.iterations, "gaussians": 1000, "psnr_holdout": 27.4}))
progress("train", 1.0)
'''

BODIES = {"pano_stitch": STITCH, "pano_sfm": SFM, "splat_train": TRAIN}


def write_fake_stages(root: Path, only=None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    for module, body in BODIES.items():
        if only is not None and module not in only:
            continue
        pkg = root / module
        pkg.mkdir(exist_ok=True)
        (pkg / "__init__.py").write_text("")
        (pkg / "__main__.py").write_text(COMMON.format(module=module, body=body))
    return root
