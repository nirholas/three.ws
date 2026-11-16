"""Build, gate and publish the NVIDIA TensorRT engine for the TripoSG denoiser.

Run inside the worker image on the GPU the engine will serve on (engines are
specific to the GPU architecture and TensorRT version; trt_policy.engine_key
encodes both). Never runs on the request path.

  python3 trt_build.py --weights /weights/triposg --inputs /inputs --work /work \
      [--publish gs://three-ws-model-weights/trt-engines/triposg]

Steps:
  1. Load the image pipeline in FP16 and capture the denoiser's real call
     signature (CFG batch 2, float32 timestep, DINOv2 condition).
  2. Export the DiT to ONNX (opset 17, FP16 weights, external data) with those
     static shapes.
  3. Build a strongly typed TensorRT engine: precision follows the exported
     graph, so the checkpoint's FP32 layer norms stay FP32 and the rest is FP16.
  4. Parity gate: run bench_trt.py for the PyTorch and TensorRT variants on
     every input with the same seed and score them against the thresholds in
     trt_policy.py. A failure exits 1 and publishes nothing.
  5. With --publish, upload the engine under its key plus a manifest
     (versions, build time, speed and parity summary) beside it.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _example_inputs(pipe, image_path: Path):
    import numpy as np
    import torch
    from diffusers.pipelines.stable_diffusion_3.pipeline_stable_diffusion_3 import retrieve_timesteps
    from image_process import prepare_image

    from trt_policy import DENOISER_BATCH, DENOISER_CHANNELS, DENOISER_TOKENS

    image = prepare_image(str(image_path), bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=None)
    embeds, negative = pipe.encode_image(image, "cuda", 1)
    condition = torch.cat([negative, embeds], dim=0)
    timesteps, _ = retrieve_timesteps(pipe.scheduler, 50, "cuda", None)
    timestep = timesteps[0].expand(DENOISER_BATCH)
    generator = torch.Generator(device="cuda").manual_seed(0)
    hidden = torch.randn(
        (DENOISER_BATCH, DENOISER_TOKENS, DENOISER_CHANNELS),
        generator=generator, device="cuda", dtype=torch.float16,
    )
    return hidden, timestep, condition


def export_onnx(pipe, image_path: Path, onnx_path: Path) -> dict:
    import torch

    hidden, timestep, condition = _example_inputs(pipe, image_path)

    class Denoiser(torch.nn.Module):
        def __init__(self, transformer):
            super().__init__()
            self.transformer = transformer

        def forward(self, hidden_states, timestep, encoder_hidden_states):
            return self.transformer(
                hidden_states, timestep,
                encoder_hidden_states=encoder_hidden_states, return_dict=False,
            )[0]

    module = Denoiser(pipe.transformer).eval()
    with torch.no_grad():
        reference = module(hidden, timestep, condition)
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with torch.no_grad():
        torch.onnx.export(
            module,
            (hidden, timestep, condition),
            str(onnx_path),
            input_names=["hidden_states", "timestep", "encoder_hidden_states"],
            output_names=["sample"],
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )
    return {
        "export_s": time.time() - started,
        "shapes": {
            "hidden_states": list(hidden.shape),
            "timestep": list(timestep.shape),
            "encoder_hidden_states": list(condition.shape),
            "sample": list(reference.shape),
        },
        "dtypes": {
            "hidden_states": str(hidden.dtype),
            "timestep": str(timestep.dtype),
            "encoder_hidden_states": str(condition.dtype),
        },
    }


def build_engine(onnx_path: Path, plan_path: Path, opt_level: int, workspace_gib: int) -> dict:
    import tensorrt as trt

    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    flags = 1 << int(trt.NetworkDefinitionCreationFlag.STRONGLY_TYPED)
    network = builder.create_network(flags)
    parser = trt.OnnxParser(network, logger)
    if not parser.parse_from_file(str(onnx_path)):
        errors = [str(parser.get_error(i)) for i in range(parser.num_errors)]
        raise RuntimeError("ONNX parse failed: " + "; ".join(errors))
    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, workspace_gib << 30)
    config.builder_optimization_level = opt_level
    started = time.time()
    plan = builder.build_serialized_network(network, config)
    if plan is None:
        raise RuntimeError("TensorRT build returned no engine (see builder log above)")
    plan_path.write_bytes(bytes(plan))
    return {
        "build_s": time.time() - started,
        "opt_level": opt_level,
        "plan_bytes": plan_path.stat().st_size,
        "layers": network.num_layers,
    }


def _bench(variant: str, args, out: Path, engine: Path | None) -> None:
    cmd = [
        sys.executable, str(HERE / "bench_trt.py"), "run",
        "--weights", args.weights, "--inputs", args.inputs,
        "--out", str(out), "--variant", variant,
    ]
    if engine is not None:
        cmd += ["--engine", str(engine)]
    if args.limit:
        cmd += ["--limit", str(args.limit)]
    subprocess.run(cmd, check=True)


def publish(plan_path: Path, manifest: dict, prefix: str) -> str:
    from google.cloud import storage

    from trt_policy import engine_uri, split_gcs_uri

    uri = engine_uri(prefix, plan_path.name)
    bucket_name, path = split_gcs_uri(uri)
    bucket = storage.Client().bucket(bucket_name)
    bucket.blob(path).upload_from_filename(str(plan_path), content_type="application/octet-stream")
    bucket.blob(path + ".json").upload_from_string(
        json.dumps(manifest, indent=2), content_type="application/json"
    )
    return uri


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--publish", default="")
    parser.add_argument("--opt-level", type=int, default=3)
    parser.add_argument("--workspace-gib", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--reuse-baseline", action="store_true", help="keep an existing pytorch run in --work")
    args = parser.parse_args(argv)

    import tensorrt as trt
    import torch
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline

    from trt_runtime import current_engine_key

    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    inputs = sorted(Path(args.inputs).glob("*.png"))
    if not inputs:
        print(f"no .png inputs under {args.inputs}", file=sys.stderr)
        return 2

    pipe = TripoSGPipeline.from_pretrained(args.weights).to("cuda", torch.float16)
    key = current_engine_key(pipe.transformer)
    plan_path = work / key
    manifest = {
        "key": key,
        "tensorrt": trt.__version__,
        "torch": torch.__version__,
        "gpu": torch.cuda.get_device_name(0),
        "capability": list(torch.cuda.get_device_capability(0)),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    print(f"engine key: {key}", flush=True)

    onnx_path = work / "onnx" / "triposg_dit.onnx"
    manifest["export"] = export_onnx(pipe, inputs[0], onnx_path)
    del pipe
    torch.cuda.empty_cache()
    manifest["build"] = build_engine(onnx_path, plan_path, args.opt_level, args.workspace_gib)
    print(json.dumps(manifest, indent=2), flush=True)

    baseline = work / "bench-pytorch"
    if not (args.reuse_baseline and (baseline / "report.json").exists()):
        _bench("pytorch", args, baseline, None)
    _bench("trt", args, work / "bench-trt", plan_path)
    parity_report = work / "parity-trt.json"
    gate = subprocess.run([
        sys.executable, str(HERE / "bench_trt.py"), "compare",
        "--a", str(baseline), "--b", str(work / "bench-trt"),
        "--report", str(parity_report), "--floor", "4",
    ])
    parity = json.loads(parity_report.read_text())
    speed = {
        name: json.loads((work / f"bench-{name}" / "report.json").read_text())["summary"]
        for name in ("pytorch", "trt")
    }
    manifest["speed"] = speed
    manifest["parity"] = {k: parity[k] for k in ("passed", "worst", "median", "thresholds", "failures")}
    (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
    if gate.returncode != 0:
        print("PARITY GATE FAILED: engine not published", file=sys.stderr)
        return 1
    if args.publish:
        print("published", publish(plan_path, manifest, args.publish), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
