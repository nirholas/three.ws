"""NVIDIA TensorRT serving path for the TripoSG denoiser.

The image pipeline spends most of its GPU time in 50 classifier-free-guided
calls of the 1.5B-parameter DiT. Every one of those calls has the same static
shapes (see trt_policy.py), so the DiT is compiled offline into one FP16
TensorRT engine per GPU architecture and TensorRT version (trt_build.py) and
published to GCS. This module loads the published engine at startup and routes
matching denoiser calls through it on PyTorch's current CUDA stream, so the
rest of the pipeline (scheduler, VAE, marching cubes) is untouched.

Fallbacks, all automatic and per call:
  - no engine for this GPU / TensorRT version / weights: PyTorch serves
  - a call whose shape, dtype or arguments the engine was not built for
    (the scribble pipeline, attention_kwargs, return_dict=True): PyTorch serves
  - the engine raises at execution: that call reruns on PyTorch and the engine
    is disabled for the life of the process, so one bad engine can never fail
    a generation.
The PyTorch DiT stays resident on the GPU for exactly that reason.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import torch

from trt_policy import (
    DENOISER_BATCH,
    DENOISER_COMPONENT,
    denoiser_call_supported,
    engine_key,
    engine_uri,
    split_gcs_uri,
    weights_fingerprint,
)

log = logging.getLogger("triposg.trt")


def _trt():
    import tensorrt as trt  # imported lazily: TRT_MODE=off never loads it

    return trt


def _torch_dtype(trt_dtype):
    trt = _trt()
    table = {
        trt.float16: torch.float16,
        trt.float32: torch.float32,
        trt.bfloat16: torch.bfloat16,
        trt.int32: torch.int32,
        trt.int64: torch.int64,
        trt.bool: torch.bool,
    }
    if trt_dtype not in table:
        raise TypeError(f"TensorRT dtype {trt_dtype} has no torch equivalent here")
    return table[trt_dtype]


class TRTEngine:
    """One deserialized engine with static I/O shapes, executed on torch's
    current stream with torch-owned buffers (no host copies, no extra CUDA
    context)."""

    def __init__(self, plan: bytes):
        trt = _trt()
        self._logger = trt.Logger(trt.Logger.WARNING)
        self._runtime = trt.Runtime(self._logger)
        self.engine = self._runtime.deserialize_cuda_engine(plan)
        if self.engine is None:
            raise RuntimeError("TensorRT could not deserialize the engine (version or GPU mismatch)")
        self.context = self.engine.create_execution_context()
        self.inputs: dict[str, tuple[tuple[int, ...], torch.dtype]] = {}
        self.outputs: dict[str, tuple[tuple[int, ...], torch.dtype]] = {}
        for i in range(self.engine.num_io_tensors):
            name = self.engine.get_tensor_name(i)
            shape = tuple(self.engine.get_tensor_shape(name))
            dtype = _torch_dtype(self.engine.get_tensor_dtype(name))
            if self.engine.get_tensor_mode(name) == trt.TensorIOMode.INPUT:
                self.inputs[name] = (shape, dtype)
            else:
                self.outputs[name] = (shape, dtype)
        if any(d < 0 for shape, _ in self.inputs.values() for d in shape):
            raise RuntimeError("engine has dynamic input dimensions; this runtime serves static engines only")

    def device_memory_bytes(self) -> int:
        return int(self.engine.device_memory_size_v2)

    def __call__(self, feeds: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        held = []
        for name, (shape, dtype) in self.inputs.items():
            tensor = feeds[name]
            if tuple(tensor.shape) != shape:
                raise ValueError(f"{name}: shape {tuple(tensor.shape)} != engine {shape}")
            tensor = tensor.to(dtype=dtype).contiguous()
            held.append(tensor)
            self.context.set_tensor_address(name, tensor.data_ptr())
        results = {}
        for name, (shape, dtype) in self.outputs.items():
            out = torch.empty(shape, dtype=dtype, device="cuda")
            results[name] = out
            self.context.set_tensor_address(name, out.data_ptr())
        stream = torch.cuda.current_stream()
        if not self.context.execute_async_v3(stream.cuda_stream):
            raise RuntimeError("TensorRT execute_async_v3 returned false")
        # `held` keeps the (possibly cast) inputs alive until the work queued on
        # this stream has consumed them; torch's caching allocator only reuses a
        # block after the owning stream passes this point.
        for tensor in held:
            tensor.record_stream(stream)
        return results


class DenoiserStats:
    def __init__(self):
        self.trt_calls = 0
        self.torch_calls = 0
        self.disabled_reason: str | None = None

    def snapshot(self) -> dict:
        return {
            "trt_calls": self.trt_calls,
            "torch_calls": self.torch_calls,
            "disabled_reason": self.disabled_reason,
        }


def install_denoiser_engine(transformer, engine: TRTEngine) -> DenoiserStats:
    """Route matching calls of `transformer` through `engine`. Replaces the
    module's bound forward, so the pipeline's own `self.transformer(...)` call
    and every module attribute it reads (config, dtype, device) are unchanged."""
    original = transformer.forward
    stats = DenoiserStats()
    output_name = next(iter(engine.outputs))

    def forward(
        hidden_states,
        timestep,
        encoder_hidden_states=None,
        encoder_hidden_states_2=None,
        image_rotary_emb=None,
        attention_kwargs=None,
        return_dict=True,
    ):
        usable = (
            stats.disabled_reason is None
            and not return_dict
            and encoder_hidden_states is not None
            and encoder_hidden_states_2 is None
            and image_rotary_emb is None
            and torch.is_tensor(timestep)
            and denoiser_call_supported(
                hidden_states.shape,
                timestep.shape,
                encoder_hidden_states.shape,
                str(hidden_states.dtype).replace("torch.", ""),
                attention_kwargs is not None,
            )
        )
        if usable:
            try:
                out = engine(
                    {
                        "hidden_states": hidden_states,
                        "timestep": timestep,
                        "encoder_hidden_states": encoder_hidden_states,
                    }
                )[output_name]
                stats.trt_calls += 1
                return (out,)
            except Exception as exc:  # noqa: BLE001, the PyTorch path below is the recovery
                stats.disabled_reason = f"{type(exc).__name__}: {exc}"
                log.error("TensorRT denoiser disabled after execution error: %s", exc)
        stats.torch_calls += 1
        return original(
            hidden_states,
            timestep,
            encoder_hidden_states=encoder_hidden_states,
            encoder_hidden_states_2=encoder_hidden_states_2,
            image_rotary_emb=image_rotary_emb,
            attention_kwargs=attention_kwargs,
            return_dict=return_dict,
        )

    transformer.forward = forward
    return stats


FINGERPRINT_SLICE = 4096


def parameter_descriptors(module) -> list[tuple[str, str]]:
    """(name, "shape:digest") per parameter, the digest over the first
    FINGERPRINT_SLICE values cast to FP16 (exact for FP16 weights, and the same
    value whichever precision a loader left a tensor in)."""
    import hashlib

    entries = []
    with torch.no_grad():
        for name, param in module.named_parameters():
            head = param.detach().reshape(-1)[:FINGERPRINT_SLICE].to(torch.float16).cpu()
            digest = hashlib.sha256(head.numpy().tobytes()).hexdigest()[:16]
            entries.append((name, f"{'x'.join(map(str, param.shape))}:{digest}"))
    return entries


def denoiser_fingerprint(transformer) -> str:
    return weights_fingerprint(dict(transformer.config), parameter_descriptors(transformer))


def current_engine_key(transformer) -> str:
    trt = _trt()
    major, minor = torch.cuda.get_device_capability(0)
    return engine_key(
        DENOISER_COMPONENT,
        denoiser_fingerprint(transformer),
        trt.__version__,
        major,
        minor,
        DENOISER_BATCH,
    )


def fetch_engine(uri: str, local_dir: str) -> Path | None:
    """Download one published engine. Returns None when it has not been
    published for this key (the PyTorch path then serves)."""
    from google.api_core.exceptions import NotFound
    from google.cloud import storage

    bucket_name, path = split_gcs_uri(uri)
    dest = Path(local_dir) / Path(path).name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    blob = storage.Client().bucket(bucket_name).blob(path)
    tmp = dest.with_suffix(".part")
    try:
        blob.download_to_filename(str(tmp))
    except NotFound:
        if tmp.exists():
            tmp.unlink()
        return None
    os.replace(tmp, dest)
    return dest


def enable_trt_denoiser(pipe, gcs_prefix: str, local_dir: str) -> dict:
    """Load this instance's published engine and install it on the image
    pipeline's DiT. Never raises: any failure is logged, returned, and leaves
    the PyTorch path serving."""
    started = time.time()
    status = {"enabled": False, "key": None, "reason": None, "load_ms": None, "stats": None}
    try:
        key = current_engine_key(pipe.transformer)
        status["key"] = key
        local = fetch_engine(engine_uri(gcs_prefix, key), local_dir)
        if local is None:
            status["reason"] = f"no published engine {key}"
            log.warning("TensorRT: %s; serving on PyTorch", status["reason"])
            return status
        engine = TRTEngine(local.read_bytes())
        status["stats"] = install_denoiser_engine(pipe.transformer, engine)
        status["enabled"] = True
        status["engine_device_bytes"] = engine.device_memory_bytes()
        log.info("TensorRT denoiser enabled: %s", key)
    except Exception as exc:  # noqa: BLE001, startup must never fail on the accelerator
        status["reason"] = f"{type(exc).__name__}: {exc}"
        log.error("TensorRT denoiser unavailable, serving on PyTorch: %s", exc)
    finally:
        status["load_ms"] = int((time.time() - started) * 1000)
    return status
