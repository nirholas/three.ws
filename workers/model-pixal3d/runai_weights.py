"""Cold-start weight loading through NVIDIA Run:ai Model Streamer.

Vendored byte-identical into every worker that uses it (see
scripts/check-vendored-workers.mjs); docs/nvidia-runai-model-streamer.md has
the measured numbers.

Why: a GPU worker's cold start is dominated by reading multi-GiB safetensors
from Cloud Storage. The previous loaders download each object with one
storage-client stream to Cloud Run's in-memory /tmp and then read it back, so
the bytes cross memory twice and a single 5.7 GB object is capped at one
connection's throughput. Run:ai Model Streamer (Apache-2.0,
github.com/run-ai/runai-model-streamer) reads a safetensors file from gs://
with many concurrent range requests straight into tensors on the target
device, with nothing written to disk.

Two shapes are supported:

  * load_diffusers_pipeline: a diffusers model_index.json tree (TripoSG). The
    small config files are downloaded, every weighted component is built on
    the meta device and its tensors are streamed onto the GPU and assigned,
    with a strict key check, so a layout the streamer cannot reproduce fails
    loudly instead of serving a half-initialised model.
  * stream_state_dict: the raw tensors of one or more files, for loaders that
    build the module themselves (Pixal3D's trellis-style from_pretrained).

Callers keep their previous loader as the fallback: choose_loader picks the
path from WEIGHTS_LOADER, and any exception on the streamer path is logged
and answered by the old path, so a streamer regression costs one slow boot,
never an outage.

The pure functions at the top import nothing heavy; test_runai_weights.py
covers them without torch, CUDA, weights or network.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field

log = logging.getLogger("runai_weights")

LOADER_RUNAI = "runai"
LOADER_STAGE = "stage"
LOADERS = (LOADER_RUNAI, LOADER_STAGE)

WEIGHT_SUFFIXES = (".safetensors", ".bin", ".pt", ".pth", ".ckpt")
# Hugging Face download bookkeeping that snapshot copies carry into the bucket.
SKIP_PREFIXES = (".cache/",)

# Concurrent range reads per file. Measured on Cloud Run L4 (8 vCPU) against a
# same-region bucket; docs/nvidia-runai-model-streamer.md has the sweep.
DEFAULT_CONCURRENCY = "32"


class NotStreamable(RuntimeError):
    """The tree has a weighted component the streamer cannot load."""


class StreamLoadMismatch(RuntimeError):
    """Streamed tensors do not match the module built from the config."""


def gcs_split(uri: str) -> tuple[str, str]:
    """Split gs://bucket/some/prefix into ("bucket", "some/prefix")."""
    if not uri.startswith("gs://"):
        raise ValueError(f"not a gs:// URI: {uri!r}")
    bucket, _, prefix = uri[len("gs://"):].partition("/")
    return bucket, prefix.strip("/")


def tree_prefix(prefix: str) -> str:
    """The listing prefix for a weight tree: always ends in exactly one "/".

    Without the slash, "triposg" also matches "triposg-scribble/...", which is
    how every model-triposg cold boot staged 11.78 GiB for a 7.4 GiB tree.
    """
    return prefix.strip("/") + "/"


def select_tree_objects(prefix: str, object_names: list[str]) -> list[str]:
    """Return the object names inside the `prefix` tree, relative to it."""
    root = tree_prefix(prefix)
    return [n[len(root):] for n in object_names if n.startswith(root) and not n.endswith("/")]


def config_files(rel_names: list[str]) -> list[str]:
    """The small files a loader needs on local disk: everything but weights."""
    return [
        n for n in rel_names
        if not n.startswith(SKIP_PREFIXES) and not n.lower().endswith(WEIGHT_SUFFIXES)
    ]


def choose_loader(requested: str | None, gcs_uri: str, streamer_available: bool) -> tuple[str, str]:
    """Pick the weight loader; returns (loader, reason) for the boot log.

    WEIGHTS_LOADER=stage forces the previous loader without a rebuild. The
    streamer path also needs a gs:// tree and an importable streamer.
    """
    value = (requested or LOADER_RUNAI).strip().lower()
    note = ""
    if value not in LOADERS:
        note = f" (ignored unknown WEIGHTS_LOADER={requested!r})"
        value = LOADER_RUNAI
    if value == LOADER_STAGE:
        return LOADER_STAGE, "WEIGHTS_LOADER=stage"
    if not gcs_uri.startswith("gs://"):
        return LOADER_STAGE, f"no gs:// weights URI{note}"
    if not streamer_available:
        return LOADER_STAGE, f"runai-model-streamer is not importable{note}"
    return LOADER_RUNAI, f"Run:ai Model Streamer from {gcs_uri}{note}"


@dataclass
class Component:
    name: str
    module: str
    class_name: str
    weight_files: list[str] = field(default_factory=list)


def plan_pipeline(model_index: dict, rel_names: list[str]) -> list[Component]:
    """Map a diffusers model_index.json onto the tree's files.

    A component with safetensors in its own directory is streamed; one with no
    weights (scheduler, image processor) loads from its downloaded config. A
    component whose weights are in another format raises NotStreamable so the
    caller falls back to the previous loader.
    """
    plan = []
    for name, spec in model_index.items():
        if name.startswith("_") or not isinstance(spec, (list, tuple)) or len(spec) != 2:
            continue
        module, class_name = spec
        if module is None or class_name is None:
            continue
        inside = [n for n in rel_names if n.startswith(name + "/") and n.count("/") == 1]
        weights = sorted(n for n in inside if n.endswith(".safetensors"))
        other = [n for n in inside if n.lower().endswith(WEIGHT_SUFFIXES) and not n.endswith(".safetensors")]
        if other and not weights:
            raise NotStreamable(f"component {name!r} has only non-safetensors weights: {other}")
        plan.append(Component(name, module, class_name, weights))
    if not plan:
        raise NotStreamable("model_index.json names no components")
    return plan


def load_with_fallback(loader: str, stream_fn, stage_fn, label: str):
    """Run the chosen loader; on any streamer failure run the previous one.

    Returns (result, used_loader, streamer_error). stream_fn and stage_fn take
    no arguments. A stage-path failure propagates: there is nothing older to
    fall back to, and the worker's own load-error handling reports it.
    """
    if loader == LOADER_RUNAI:
        try:
            return stream_fn(), LOADER_RUNAI, None
        except Exception as exc:  # noqa: BLE001, the previous loader answers instead
            err = f"{type(exc).__name__}: {exc}"
            log.warning("%s: Run:ai streamer load failed (%s); falling back to the staged loader", label, err)
            _release_gpu_cache()
            return stage_fn(), LOADER_STAGE, err
    return stage_fn(), LOADER_STAGE, None


def _release_gpu_cache() -> None:
    """Return a failed streamer attempt's partial tensors to the allocator."""
    import gc
    import sys

    gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()


def streamer_available() -> bool:
    try:
        import runai_model_streamer  # noqa: F401
    except Exception:  # noqa: BLE001, any import failure means "use the old loader"
        return False
    return True


def _apply_streamer_env() -> None:
    os.environ.setdefault("RUNAI_STREAMER_CONCURRENCY", DEFAULT_CONCURRENCY)


def stream_state_dict(uris: list[str], device: str = "cpu", dtype=None) -> tuple[dict, int, float]:
    """Stream every tensor of `uris` onto `device`; returns (tensors, bytes, seconds).

    Floating tensors are cast to `dtype` as they land, so a fp32 checkpoint
    bound for a fp16 pipeline never holds both copies on the GPU at once.
    """
    _apply_streamer_env()
    from runai_model_streamer import SafetensorsStreamer

    tensors = {}
    t0 = time.monotonic()
    with SafetensorsStreamer() as streamer:
        streamer.stream_files(list(uris), device=device)
        for name, tensor in streamer.get_tensors():
            if dtype is not None and tensor.is_floating_point():
                tensor = tensor.to(dtype)
            tensors[name] = tensor
        total = int(streamer.total_size)
    return tensors, total, time.monotonic() - t0


def stream_into_module(module, uris: list[str], strict: bool) -> tuple[int, float]:
    """Stream `uris` onto CPU and copy them into an already-built module.

    The trellis-style loaders (Pixal3D) construct the module from its JSON
    config and then call load_state_dict(load_file(path), strict=False); this
    keeps that exact construction and key semantics and replaces only the read.
    Returns (bytes, seconds).
    """
    tensors, size, seconds = stream_state_dict(uris, device="cpu")
    module.load_state_dict(tensors, strict=strict)
    return size, seconds


def _empty_module(cls, comp_dir: str):
    """Build `cls` from its config on the meta device (no weight init cost)."""
    from accelerate import init_empty_weights

    with init_empty_weights():
        if hasattr(cls, "load_config") and hasattr(cls, "from_config"):
            return cls.from_config(cls.load_config(comp_dir))
        from transformers import AutoConfig

        return cls._from_config(AutoConfig.from_pretrained(comp_dir))


def assign_state_dict(module, tensors: dict, label: str):
    """Assign streamed tensors to a meta-built module, strictly."""
    missing, unexpected = module.load_state_dict(tensors, strict=False, assign=True)
    if missing or unexpected:
        raise StreamLoadMismatch(
            f"{label}: {len(missing)} missing keys {missing[:5]}, "
            f"{len(unexpected)} unexpected keys {unexpected[:5]}"
        )
    still_meta = [n for n, p in list(module.named_parameters()) + list(module.named_buffers()) if p.is_meta]
    if still_meta:
        raise StreamLoadMismatch(f"{label}: tensors left uninitialised: {still_meta[:5]}")
    return module


def _download_configs(bucket, prefix: str, names: list[str], local_dir: str) -> None:
    from concurrent.futures import ThreadPoolExecutor

    def fetch(rel: str) -> None:
        dest = os.path.join(local_dir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        bucket.blob(f"{prefix}/{rel}").download_to_filename(dest)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch, names))


def load_diffusers_pipeline(pipeline_cls, gcs_uri: str, local_dir: str, device: str, dtype):
    """Build a diffusers pipeline from a gs:// tree with streamed weights.

    Returns (pipeline, stats) where stats carries bytes, seconds and GiB/s for
    the boot log and the cold-start bench.
    """
    import importlib

    from google.cloud import storage

    bucket_name, prefix = gcs_split(gcs_uri)
    client = storage.Client()
    names = [b.name for b in client.list_blobs(bucket_name, prefix=tree_prefix(prefix))]
    rel = select_tree_objects(prefix, names)
    if "model_index.json" not in rel:
        raise NotStreamable(f"{gcs_uri} has no model_index.json")
    bucket = client.bucket(bucket_name)
    t0 = time.monotonic()
    _download_configs(bucket, prefix, config_files(rel), local_dir)
    with open(os.path.join(local_dir, "model_index.json")) as fh:
        plan = plan_pipeline(json.load(fh), rel)

    components = {}
    total_bytes = 0
    stream_s = 0.0
    for comp in plan:
        cls = getattr(importlib.import_module(comp.module), comp.class_name)
        comp_dir = os.path.join(local_dir, comp.name)
        if not comp.weight_files:
            components[comp.name] = cls.from_pretrained(comp_dir)
            continue
        module = _empty_module(cls, comp_dir)
        uris = [f"gs://{bucket_name}/{prefix}/{f}" for f in comp.weight_files]
        tensors, size, seconds = stream_state_dict(uris, device=device, dtype=dtype)
        assign_state_dict(module, tensors, comp.name)
        module.to(device=device, dtype=dtype)
        module.eval()
        components[comp.name] = module
        total_bytes += size
        stream_s += seconds
        log.info(
            "runai streamer: %s %.2f GiB in %.1fs (%.2f GiB/s)",
            comp.name, size / 2**30, seconds, size / 2**30 / max(seconds, 1e-6),
        )
    pipe = pipeline_cls(**components)
    stats = {
        "bytes": total_bytes,
        "stream_seconds": round(stream_s, 2),
        "total_seconds": round(time.monotonic() - t0, 2),
        "gib_per_s": round(total_bytes / 2**30 / max(stream_s, 1e-6), 2),
    }
    return pipe, stats
