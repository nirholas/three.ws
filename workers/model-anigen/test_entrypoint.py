"""Tests for entrypoint.sh's checkpoint staging. Plain python + /bin/sh, no
GPU, no torch: runs at image build time (Dockerfile) and locally with
`python3 test_entrypoint.py`.

The failure this guards (first europe-west4 deploy, 2026-11-04): the old
entrypoint copied the whole 18 GiB `ckpts/anigen` tree (seven flow and
autoencoder checkpoints, three of them unused, plus both encoders) into
Cloud Run's in-memory filesystem of a 16 GiB container, never staged
`ckpts/dinov2` at all, and served from a directory AniGen's cwd-relative
loads (`./ckpts/dinov2`, `ckpts/anigen/ss_dae`, ...) do not resolve against
unless it happens to be /app. The revision never passed its startup probe.

Each test builds a fake bucket mount holding every file the real one holds
(sizes aside), runs the real entrypoint.sh with a fake `uvicorn` on PATH
that records its cwd and argv, and checks what was staged.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENTRYPOINT = HERE / "entrypoint.sh"

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    print(f"  [{'ok' if cond else 'FAIL'}] {label}")
    if not cond:
        _FAILED = True


# Every file under gs://three-ws-model-weights/anigen/ckpts that matters to
# the staging decision (listed 2026-11-04), whether or not serving reads it.
BUCKET_FILES = [
    "anigen/ss_flow_solo/config.json",
    "anigen/ss_flow_solo/ckpts/denoiser.pt",
    "anigen/ss_flow_duet/config.json",
    "anigen/ss_flow_duet/ckpts/denoiser.pt",
    "anigen/ss_flow_epic/config.json",
    "anigen/ss_flow_epic/ckpts/denoiser.pt",
    "anigen/slat_flow_auto/config.json",
    "anigen/slat_flow_auto/ckpts/denoiser.pt",
    "anigen/slat_flow_control/config.json",
    "anigen/slat_flow_control/ckpts/denoiser.pt",
    "anigen/ss_dae/config.json",
    "anigen/ss_dae/ckpts/decoder_final.pt",
    "anigen/ss_dae/ckpts/encoder_final.pt",
    "anigen/slat_dae/config.json",
    "anigen/slat_dae/ckpts/decoder_final.pt",
    "anigen/slat_dae/ckpts/encoder_final.pt",
    "dinov2/hubconf.py",
    "dinov2/README.md",
    "dinov2/dinov2/__init__.py",
    "dinov2/dinov2/hub/backbones.py",
    "dinov2/dinov2/hub/utils.py",
    "dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth",
    "dinov2/notebooks/semantic_segmentation.ipynb",
    "dsine/dsine.pt",
    "dsine/tf_efficientnet_b5_ap-9e82fae8.pth",
    "vgg/vgg16-397923af.pth",
    "marigold-normals-lcm-v0-1/model_index.json",
    "marigold-normals-lcm-v0-1/scheduler/scheduler_config.json",
    "marigold-normals-lcm-v0-1/text_encoder/config.json",
    "marigold-normals-lcm-v0-1/text_encoder/model.fp16.safetensors",
    "marigold-normals-lcm-v0-1/tokenizer/vocab.json",
    "marigold-normals-lcm-v0-1/unet/config.json",
    "marigold-normals-lcm-v0-1/unet/diffusion_pytorch_model.fp16.safetensors",
    "marigold-normals-lcm-v0-1/vae/config.json",
    "marigold-normals-lcm-v0-1/vae/diffusion_pytorch_model.fp16.safetensors",
]

# Exactly what serving opens: the two flows main.py names, the two decoders
# their configs point at (ss_dec_path / slat_dec_path, ckpt "final"), DINOv2
# as a local torch.hub repo plus its reg4 weights, and the Marigold normals
# model that replaces DSINE (patch_anigen.py).
EXPECTED_STAGED = {
    "anigen/ss_flow_solo/config.json",
    "anigen/ss_flow_solo/ckpts/denoiser.pt",
    "anigen/slat_flow_auto/config.json",
    "anigen/slat_flow_auto/ckpts/denoiser.pt",
    "anigen/ss_dae/config.json",
    "anigen/ss_dae/ckpts/decoder_final.pt",
    "anigen/slat_dae/config.json",
    "anigen/slat_dae/ckpts/decoder_final.pt",
    "dinov2/hubconf.py",
    "dinov2/dinov2/__init__.py",
    "dinov2/dinov2/hub/backbones.py",
    "dinov2/dinov2/hub/utils.py",
    "dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth",
    "marigold-normals-lcm-v0-1/model_index.json",
    "marigold-normals-lcm-v0-1/scheduler/scheduler_config.json",
    "marigold-normals-lcm-v0-1/text_encoder/config.json",
    "marigold-normals-lcm-v0-1/text_encoder/model.fp16.safetensors",
    "marigold-normals-lcm-v0-1/tokenizer/vocab.json",
    "marigold-normals-lcm-v0-1/unet/config.json",
    "marigold-normals-lcm-v0-1/unet/diffusion_pytorch_model.fp16.safetensors",
    "marigold-normals-lcm-v0-1/vae/config.json",
    "marigold-normals-lcm-v0-1/vae/diffusion_pytorch_model.fp16.safetensors",
}

FAKE_UVICORN = """#!/bin/sh
pwd > "$UVICORN_RECORD"
for a in "$@"; do echo "$a" >> "$UVICORN_RECORD"; done
"""


def _setup(root: Path, files: list[str]) -> dict:
    weights = root / "weights"
    for rel in files:
        p = weights / "ckpts" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(rel)
    bindir = root / "bin"
    bindir.mkdir()
    uvicorn = bindir / "uvicorn"
    uvicorn.write_text(FAKE_UVICORN)
    uvicorn.chmod(uvicorn.stat().st_mode | stat.S_IEXEC)
    ckpt_root = root / "ckpt-root"
    ckpt_root.mkdir()
    return {
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "WEIGHTS_ROOT": str(weights),
        "ANIGEN_CKPT_ROOT": str(ckpt_root),
        "APP_DIR": str(HERE),
        "UVICORN_RECORD": str(root / "uvicorn.txt"),
    }


def _run(env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/bin/sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=60
    )


def _staged(ckpt_root: Path) -> set[str]:
    base = ckpt_root / "ckpts"
    return {str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()}


def test_stages_exactly_what_serving_opens():
    root = Path(tempfile.mkdtemp())
    try:
        env = _setup(root, BUCKET_FILES)
        result = _run(env)
        _check(result.returncode == 0, f"entrypoint exits 0 (stderr: {result.stderr.strip()[-300:]})")
        staged = _staged(Path(env["ANIGEN_CKPT_ROOT"]))
        _check(staged == EXPECTED_STAGED, "staged set is exactly the serving set")
        for extra in sorted(staged - EXPECTED_STAGED):
            print(f"      unexpected: {extra}")
        for missing in sorted(EXPECTED_STAGED - staged):
            print(f"      missing: {missing}")
        _check(not any("encoder_final" in s for s in staged), "no autoencoder encoders (inference only decodes)")
        _check(not any(s.startswith(("dsine/", "vgg/")) for s in staged), "no DSINE (non-commercial) and no VGG (training loss only)")
        for rel in ("dinov2/hubconf.py", "anigen/ss_flow_solo/ckpts/denoiser.pt"):
            p = Path(env["ANIGEN_CKPT_ROOT"]) / "ckpts" / rel
            _check(p.exists() and p.read_text() == rel, f"{rel} copied with its content")
    finally:
        shutil.rmtree(root)


def test_serves_from_the_checkpoint_root_so_relative_loads_resolve():
    root = Path(tempfile.mkdtemp())
    try:
        env = _setup(root, BUCKET_FILES)
        _run(env)
        record = Path(env["UVICORN_RECORD"])
        _check(record.exists(), "uvicorn was exec'd")
        if not record.exists():
            return
        lines = record.read_text().splitlines()
        _check(Path(lines[0]).resolve() == Path(env["ANIGEN_CKPT_ROOT"]).resolve(),
               f"cwd is ANIGEN_CKPT_ROOT, where ./ckpts/... resolves (got {lines[0]})")
        args = lines[1:]
        _check("main:app" in args, "serves main:app")
        _check("--app-dir" in args and args[args.index("--app-dir") + 1] == env["APP_DIR"],
               "imports main.py from APP_DIR, not the cwd")
    finally:
        shutil.rmtree(root)


def test_a_missing_checkpoint_fails_before_serving_and_names_it():
    root = Path(tempfile.mkdtemp())
    try:
        files = [f for f in BUCKET_FILES if f != "dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth"]
        env = _setup(root, files)
        result = _run(env)
        _check(result.returncode != 0, "non-zero exit")
        _check("dinov2_vitl14_reg4_pretrain.pth" in result.stderr, f"names the missing file (stderr: {result.stderr.strip()[-200:]})")
        _check("stage-assets.sh" in result.stderr, "points at the staging script")
        _check(not Path(env["UVICORN_RECORD"]).exists(), "never starts serving")
    finally:
        shutil.rmtree(root)


def test_main_py_flow_paths_are_the_staged_flows():
    """main.py names the flow checkpoints; the entrypoint must stage those,
    not a different pair."""
    text = (HERE / "main.py").read_text()
    flows = re.findall(r'os\.path\.join\(ANIGEN_CKPT_ROOT, "ckpts", "anigen", "([\w]+)"\)', text)
    _check(sorted(flows) == ["slat_flow_auto", "ss_flow_solo"], f"main.py flows: {flows}")
    for flow in flows:
        _check(f"anigen/{flow}/ckpts/denoiser.pt" in EXPECTED_STAGED, f"{flow} is staged")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(name)
            fn()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
