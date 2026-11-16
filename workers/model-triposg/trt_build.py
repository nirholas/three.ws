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
  3. Apply the precision policy to the graph, then build a strongly typed
     TensorRT engine (precision follows the graph exactly). "fp16" leaves the
     export as is; "fp32-norm" runs every FP16 LayerNormalization in FP32, the
     way PyTorch's fused layer_norm accumulates; "fp32-norm-softmax" also runs
     the attention softmax in FP32.
  3b. Numerics: on real denoiser calls captured from sampling runs, measure the
     engine's relative error against an FP32 PyTorch reference next to PyTorch
     FP16's own error against the same reference (--numerics-only stops here,
     for comparing policies before the long gate).
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


POLICIES = ("fp16", "fp32-norm", "fp32-norm-softmax")


def apply_precision_policy(onnx_path: Path, out_path: Path, policy: str) -> dict:
    """Rewrite the FP16 graph so the chosen ops compute in FP32: Cast their
    FP16 inputs up and their first output back down. Element types come from
    ONNX shape inference on the weight-free graph, so a node that already runs
    in FP32 is left alone."""
    import onnx
    from onnx import TensorProto, helper

    if policy not in POLICIES:
        raise ValueError(f"unknown precision policy {policy!r}")
    if policy == "fp16":
        return {"policy": policy, "nodes": 0, "onnx": str(onnx_path)}
    ops = {"LayerNormalization"} | ({"Softmax"} if policy == "fp32-norm-softmax" else set())

    skeleton = onnx.shape_inference.infer_shapes(onnx.load(str(onnx_path), load_external_data=False))
    elem = {}
    for v in list(skeleton.graph.input) + list(skeleton.graph.value_info) + list(skeleton.graph.output):
        elem[v.name] = v.type.tensor_type.elem_type
    for init in skeleton.graph.initializer:
        elem[init.name] = init.data_type

    model = onnx.load(str(onnx_path))
    nodes, changed = [], 0
    for index, node in enumerate(model.graph.node):
        if node.op_type not in ops or elem.get(node.input[0]) != TensorProto.FLOAT16:
            nodes.append(node)
            continue
        tag = f"{node.name or node.op_type}_{index}_fp32"
        inputs = []
        for i, name in enumerate(node.input):
            if name and elem.get(name) == TensorProto.FLOAT16:
                cast = f"{tag}_in{i}"
                nodes.append(helper.make_node("Cast", [name], [cast], to=TensorProto.FLOAT, name=cast))
                inputs.append(cast)
            else:
                inputs.append(name)
        outputs = list(node.output)
        wide = f"{tag}_out0"
        final = outputs[0]
        outputs[0] = wide
        del node.input[:]
        node.input.extend(inputs)
        del node.output[:]
        node.output.extend(outputs)
        nodes.append(node)
        nodes.append(helper.make_node("Cast", [wide], [final], to=TensorProto.FLOAT16, name=f"{tag}_down"))
        changed += 1
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(
        model, str(out_path), save_as_external_data=True,
        all_tensors_to_one_file=True, location=out_path.name + ".data",
    )
    return {"policy": policy, "nodes": changed, "onnx": str(out_path)}


def capture_denoiser_calls(pipe, image_paths, steps=(0, 12, 25, 37, 49)) -> list:
    """Record the DiT's real inputs at the given sampling steps for each image
    (same seed and settings as production), stopping each run after the last
    step so geometry extraction is not paid for."""
    import numpy as np
    import torch
    from image_process import prepare_image
    from request_policy import IMAGE_MODE, pipeline_settings

    class _Done(Exception):
        pass

    captured = []
    original = pipe.transformer.forward
    for path in image_paths:
        image = prepare_image(str(path), bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=None)
        counter = {"step": 0}

        def hook(hidden_states, timestep, encoder_hidden_states=None, **kwargs):
            step = counter["step"]
            counter["step"] += 1
            if step in steps:
                captured.append({
                    "input": path.name, "step": step,
                    "hidden_states": hidden_states.detach().clone(),
                    "timestep": timestep.detach().clone(),
                    "encoder_hidden_states": encoder_hidden_states.detach().clone(),
                })
            result = original(hidden_states, timestep, encoder_hidden_states=encoder_hidden_states, **kwargs)
            if step >= max(steps):
                raise _Done
            return result

        pipe.transformer.forward = hook
        try:
            with torch.no_grad():
                pipe(image=image, generator=torch.Generator(device="cuda").manual_seed(0), **pipeline_settings(IMAGE_MODE))
        except _Done:
            pass
        finally:
            pipe.transformer.forward = original
    return captured


def numerics(pipe, plans: dict, calls: list) -> dict:
    """Relative L2 error of each engine's denoiser output, and of PyTorch FP16's,
    against an FP32 PyTorch reference on the same captured calls. The FP32
    reference runs first and is freed before any engine is loaded, so the
    comparison fits on one 24 GB card."""
    import copy
    import statistics

    import torch

    from trt_runtime import TRTEngine

    def feed(call):
        return call["hidden_states"], call["timestep"], call["encoder_hidden_states"]

    with torch.no_grad():
        reference = copy.deepcopy(pipe.transformer).float()
        refs = []
        for call in calls:
            h, t, c = feed(call)
            refs.append(reference(h.float(), t.float(), encoder_hidden_states=c.float(), return_dict=False)[0].float())
        del reference
        torch.cuda.empty_cache()

        rows = [{"input": call["input"], "step": call["step"]} for call in calls]

        def score(name, run):
            for row, call, ref in zip(rows, calls, refs):
                row[name] = (run(*feed(call)).float() - ref).norm().item() / ref.norm().item()

        score("pytorch_fp16", lambda h, t, c: pipe.transformer(h, t, encoder_hidden_states=c, return_dict=False)[0])
        for name, path in plans.items():
            engine = TRTEngine(path.read_bytes())
            score(name, lambda h, t, c: next(iter(engine({
                "hidden_states": h, "timestep": t, "encoder_hidden_states": c,
            }).values())))
            del engine
            torch.cuda.empty_cache()
    names = ["pytorch_fp16", *plans]
    return {
        "rows": rows,
        "median": {n: statistics.median(r[n] for r in rows) for n in names},
        "max": {n: max(r[n] for r in rows) for n in names},
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
    parser.add_argument("--policy", choices=POLICIES, default="fp32-norm")
    parser.add_argument("--numerics-only", action="store_true", help="build every policy, report numerics, stop")
    parser.add_argument("--numerics-inputs", type=int, default=3)
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
    if args.reuse_baseline and onnx_path.exists():
        manifest["export"] = {"reused": str(onnx_path)}
    else:
        manifest["export"] = export_onnx(pipe, inputs[0], onnx_path)

    policies = POLICIES if args.numerics_only else (args.policy,)
    plans = {}
    for policy in policies:
        graph = apply_precision_policy(onnx_path, work / f"onnx-{policy}" / "triposg_dit.onnx", policy)
        target = plan_path if policy == args.policy else work / f"{policy}.plan"
        info = build_engine(Path(graph["onnx"]), target, args.opt_level, args.workspace_gib)
        manifest.setdefault("builds", {})[policy] = {**graph, **info}
        plans[policy] = target
        print(json.dumps({policy: manifest["builds"][policy]}), flush=True)
    manifest["policy"] = args.policy
    manifest["build"] = manifest["builds"][args.policy] if args.policy in manifest["builds"] else None

    calls = capture_denoiser_calls(pipe, inputs[: args.numerics_inputs])
    manifest["numerics"] = numerics(pipe, plans, calls)
    del calls, pipe
    torch.cuda.empty_cache()
    print(json.dumps({"numerics": {k: manifest["numerics"][k] for k in ("median", "max")}}, indent=2), flush=True)
    (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
    if args.numerics_only:
        return 0

    baseline = work / "bench-pytorch"
    if not (args.reuse_baseline and (baseline / "report.json").exists()):
        _bench("pytorch", args, baseline, None)
    candidate = work / f"bench-trt-{args.policy}"
    _bench("trt", args, candidate, plan_path)
    parity_report = work / f"parity-trt-{args.policy}.json"
    gate = subprocess.run([
        sys.executable, str(HERE / "bench_trt.py"), "compare",
        "--a", str(baseline), "--b", str(candidate),
        "--report", str(parity_report), "--floor", "4",
    ])
    parity = json.loads(parity_report.read_text())
    speed = {
        name: json.loads((path / "report.json").read_text())["summary"]
        for name, path in (("pytorch", baseline), (f"trt-{args.policy}", candidate))
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
