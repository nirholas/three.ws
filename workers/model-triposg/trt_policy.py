"""TensorRT policy for the TripoSG worker: the serving flag, engine cache keys,
the shape gate that decides when the TensorRT engine may serve a denoiser call,
and the output-parity thresholds an engine must clear before it is published.

Like request_policy.py, this module imports no torch, no TensorRT and no CUDA,
so every decision here is unit tested on any machine (test_trt_policy.py).
trt_runtime.py (serving), trt_build.py (offline engine build) and bench_trt.py
(baseline, speed and parity harness) all import it, so the three can never
disagree about which engine belongs to which GPU, TensorRT version and weights.

Engines are built ahead of time on the matching GPU, never on the request path.
A serving instance downloads the engine whose key matches its own GPU compute
capability, TensorRT version and weight fingerprint; if there is none, it serves
on the PyTorch path exactly as before.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

# Serving flag. "off" keeps the pure PyTorch path. "on" loads the published
# engine for this GPU and TensorRT version and serves the denoiser through it,
# falling back to PyTorch for any call the engine cannot take.
TRT_MODE_ENV = "TRT_MODE"
TRT_MODES = ("off", "on")

# Where published engines live. One object per (component, weights, TensorRT
# version, GPU architecture, batch, precision); see engine_key().
DEFAULT_ENGINE_GCS_PREFIX = "gs://three-ws-model-weights/trt-engines/triposg"

# The image pipeline's denoiser call is fully static: classifier-free guidance
# doubles the batch to 2, the latent is 2048 tokens of 64 channels, and the
# DINOv2-large condition is 257 tokens of 1024 channels. The engine is built for
# exactly these shapes; anything else (the scribble pipeline's batch of 1, a
# caller passing num_tokens) runs on PyTorch.
DENOISER_COMPONENT = "dit"
DENOISER_BATCH = 2
DENOISER_TOKENS = 2048
DENOISER_CHANNELS = 64
CONDITION_TOKENS = 257
CONDITION_CHANNELS = 1024

# Output parity, stated before any engine is built. An engine is published only
# when EVERY benchmark input clears all three, comparing the TensorRT output to
# the PyTorch output for the same image and seed.
#   chamfer: mean of the two directed mean nearest-neighbour distances between
#            200k surface samples of each mesh, in the model's own units (the
#            mesh lives in a 2.01-wide cube, so 0.01 is 0.5% of the extent).
#   psnr / ssim: depth and normal shaded renders from 6 fixed orthographic
#            views, 512 px, averaged over the views (parity.py).
PARITY_MAX_CHAMFER = 0.01
PARITY_MIN_PSNR_DB = 28.0
PARITY_MIN_SSIM = 0.95


def trt_mode(environ=None) -> str:
    """Normalize the serving flag. Anything unrecognized is "off": the PyTorch
    path is the safe default, never a half-configured engine."""
    env = os.environ if environ is None else environ
    raw = env.get(TRT_MODE_ENV, "")
    value = raw.strip().lower() if isinstance(raw, str) else ""
    return value if value in TRT_MODES else "off"


def sm_tag(major: int, minor: int) -> str:
    """Compute capability as a path-safe tag: the L4 (8.9) is "sm89"."""
    return f"sm{int(major)}{int(minor)}"


def trt_version_tag(version: str) -> str:
    """TensorRT version as a path-safe tag. Engines are not portable across
    TensorRT releases, so the full version is part of the key."""
    if not isinstance(version, str) or not re.fullmatch(r"\d+(\.\d+)*", version.strip()):
        raise ValueError(f"unrecognized TensorRT version: {version!r}")
    return "trt" + version.strip()


def weights_fingerprint(config: dict, parameters: list[tuple[str, str]]) -> str:
    """Short stable fingerprint of a loaded denoiser: its config plus one
    descriptor per parameter (name, shape and a digest of a leading slice of
    its values; see trt_runtime.parameter_descriptors). It reads the module
    already on the GPU, so it is the same whichever loader produced it (Run:ai
    streamer or staged files) and costs milliseconds, while a retrained or
    re-exported checkpoint still changes it: the engine has the weights baked
    in, so that is the event the key must notice."""
    payload = {
        "config": {k: v for k, v in sorted(config.items()) if not k.startswith("_")},
        "parameters": sorted((str(name), str(desc)) for name, desc in parameters),
    }
    if not payload["parameters"]:
        raise ValueError("a denoiser with no parameters has no fingerprint")
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def engine_key(
    component: str,
    fingerprint: str,
    trt_version: str,
    sm_major: int,
    sm_minor: int,
    batch: int,
    precision: str = "fp16",
) -> str:
    """File name of one engine. Every field that makes an engine unusable when
    it changes is in the name, so a mismatched engine is simply never found."""
    if precision not in ("fp16", "fp8"):
        raise ValueError(f"unsupported precision: {precision!r}")
    return (
        f"triposg-{component}-{fingerprint}-{trt_version_tag(trt_version)}"
        f"-{sm_tag(sm_major, sm_minor)}-b{int(batch)}-{precision}.plan"
    )


def engine_uri(prefix: str, key: str) -> str:
    return prefix.rstrip("/") + "/" + key


def split_gcs_uri(uri: str) -> tuple[str, str]:
    """gs://bucket/path -> (bucket, path)."""
    if not isinstance(uri, str) or not uri.startswith("gs://"):
        raise ValueError(f"not a gs:// uri: {uri!r}")
    rest = uri[len("gs://"):]
    bucket, _, path = rest.partition("/")
    if not bucket:
        raise ValueError(f"gs:// uri has no bucket: {uri!r}")
    return bucket, path


def denoiser_call_supported(
    hidden_shape,
    timestep_shape,
    condition_shape,
    dtype_name: str,
    has_attention_kwargs: bool,
) -> bool:
    """True when a denoiser call matches the static engine exactly. The engine
    has no attention-processor hooks, so any attention_kwargs (LoRA scales, the
    scribble pipeline's cross-attention scale) send the call to PyTorch."""
    if has_attention_kwargs:
        return False
    if dtype_name != "float16":
        return False
    return (
        tuple(hidden_shape) == (DENOISER_BATCH, DENOISER_TOKENS, DENOISER_CHANNELS)
        and tuple(timestep_shape) == (DENOISER_BATCH,)
        and tuple(condition_shape) == (DENOISER_BATCH, CONDITION_TOKENS, CONDITION_CHANNELS)
    )


def parity_verdict(rows: list[dict]) -> dict:
    """Apply the parity thresholds to per-input metrics. Each row carries
    `input`, `chamfer`, `psnr`, `ssim`. Returns {passed, failures, worst}.
    An empty set never passes: no evidence is not parity."""
    failures = []
    for row in rows:
        reasons = []
        if row.get("chamfer") is None or row["chamfer"] > PARITY_MAX_CHAMFER:
            reasons.append(f"chamfer {row.get('chamfer')} > {PARITY_MAX_CHAMFER}")
        if row.get("psnr") is None or row["psnr"] < PARITY_MIN_PSNR_DB:
            reasons.append(f"psnr {row.get('psnr')} < {PARITY_MIN_PSNR_DB}")
        if row.get("ssim") is None or row["ssim"] < PARITY_MIN_SSIM:
            reasons.append(f"ssim {row.get('ssim')} < {PARITY_MIN_SSIM}")
        if reasons:
            failures.append({"input": row.get("input"), "reasons": reasons})
    def _extreme(fn, key):
        values = [r[key] for r in rows if r.get(key) is not None]
        return fn(values) if values else None

    worst = {
        "chamfer": _extreme(max, "chamfer"),
        "psnr": _extreme(min, "psnr"),
        "ssim": _extreme(min, "ssim"),
    }
    return {"passed": bool(rows) and not failures, "failures": failures, "worst": worst}
