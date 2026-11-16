"""TripoSG speed and parity harness for the TensorRT work (order 861).

Runs inside the worker image on a real GPU. Two subcommands:

  run      Generate a mesh for every image in --inputs with a fixed seed,
           timing each pipeline stage, and write meshes plus a JSON report.
           --variant picks the serving path, using the SAME hooks main.py
           installs in production:
             pytorch       upstream path, unchanged
             kvcache       + decode_cache (decoder KV memo, exact)
             trt           + TensorRT denoiser engine (--engine)
             trt-kvcache   both
  compare  Score variant B against variant A per input (parity.py) and apply
           the thresholds in trt_policy.py. Exit status 1 when parity fails,
           so a build script can gate on it.

Stage times are wall clock with torch.cuda.synchronize at every boundary:
  encode    DINOv2 image condition (pipe.encode_image)
  denoise   the 50-step rectified-flow loop (DiT x 50, CFG batch 2)
  geometry  flash octree extraction: VAE decoder queries + marching cubes
  decode    the VAE decoder calls inside geometry (count reported too)
  export    trimesh -> GLB bytes, as main.py does
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np


def _percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def _summary(values):
    return {
        "n": len(values),
        "mean": statistics.fmean(values) if values else None,
        "p50": _percentile(values, 50),
        "p95": _percentile(values, 95),
        "min": min(values) if values else None,
        "max": max(values) if values else None,
    }


def _prepare(path: Path):
    from image_process import prepare_image

    prepared = prepare_image(str(path), bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=None)
    if not hasattr(prepared, "size"):
        raise RuntimeError(f"{path.name}: upstream prepare_image rejected the input: {prepared}")
    return prepared


class StageClock:
    """Accumulates synchronized wall time per stage for one generation."""

    def __init__(self, torch):
        self.torch = torch
        self.reset()

    def reset(self):
        self.times = {"encode": 0.0, "geometry": 0.0, "decode": 0.0}
        self.decode_calls = 0

    def wrap(self, name, fn, count=False):
        torch = self.torch

        def timed(*args, **kwargs):
            torch.cuda.synchronize()
            t = time.perf_counter()
            result = fn(*args, **kwargs)
            torch.cuda.synchronize()
            self.times[name] += time.perf_counter() - t
            if count:
                self.decode_calls += 1
            return result

        return timed


def cmd_run(args) -> int:
    import torch
    import trimesh

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from request_policy import IMAGE_MODE, pipeline_settings

    out = Path(args.out)
    (out / "meshes").mkdir(parents=True, exist_ok=True)
    inputs = sorted(Path(args.inputs).glob("*.png"))
    if args.limit:
        inputs = inputs[: args.limit]
    if not inputs:
        print(f"no .png inputs under {args.inputs}", file=sys.stderr)
        return 2

    report = {
        "variant": args.variant,
        "gpu": torch.cuda.get_device_name(0),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "inputs": [p.name for p in inputs],
        "seed": 0,
        "settings": pipeline_settings(IMAGE_MODE),
    }

    t_load = time.perf_counter()
    import triposg.pipelines.pipeline_triposg as pipeline_module
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline

    pipe = TripoSGPipeline.from_pretrained(args.weights).to("cuda", torch.float16)
    torch.cuda.synchronize()
    report["load_pipeline_s"] = time.perf_counter() - t_load

    hooks = {}
    if args.variant in ("kvcache", "trt-kvcache"):
        from decode_cache import install_decoder_kv_cache

        hooks["kv"] = install_decoder_kv_cache(pipe.vae.decoder)
    if args.variant in ("trt", "trt-kvcache"):
        import tensorrt as trt
        from trt_runtime import TRTEngine, install_denoiser_engine

        t_engine = time.perf_counter()
        engine = TRTEngine(Path(args.engine).read_bytes())
        hooks["trt"] = install_denoiser_engine(pipe.transformer, engine)
        torch.cuda.synchronize()
        report["load_engine_s"] = time.perf_counter() - t_engine
        report["tensorrt"] = trt.__version__
        report["engine"] = Path(args.engine).name
        report["engine_device_bytes"] = engine.device_memory_bytes()

    free, total = torch.cuda.mem_get_info()
    report["device_used_after_load_bytes"] = total - free
    report["torch_allocated_after_load_bytes"] = torch.cuda.memory_allocated()

    clock = StageClock(torch)
    pipe.encode_image = clock.wrap("encode", pipe.encode_image)
    pipe.vae.decode = clock.wrap("decode", pipe.vae.decode, count=True)
    pipeline_module.flash_extract_geometry = clock.wrap(
        "geometry", pipeline_module.flash_extract_geometry
    )

    def generate(image):
        generator = torch.Generator(device="cuda").manual_seed(0)
        torch.cuda.synchronize()
        t = time.perf_counter()
        with torch.no_grad():
            samples = pipe(image=image, generator=generator, **pipeline_settings(IMAGE_MODE)).samples[0]
        torch.cuda.synchronize()
        pipeline_s = time.perf_counter() - t
        return samples, pipeline_s

    # First generation after load: what the first real request on a fresh
    # instance pays (kernel selection, allocator growth). Reported, then the
    # measured set starts from a warm process.
    warm_image = _prepare(inputs[0])
    clock.reset()
    _, first_s = generate(warm_image)
    report["first_generation_s"] = first_s

    rows = []
    for index, path in enumerate(inputs):
        image = _prepare(path)
        clock.reset()
        torch.cuda.reset_peak_memory_stats()
        if args.profile and index == 0:
            from torch.profiler import ProfilerActivity, profile

            with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
                samples, pipeline_s = generate(image)
            (out / "profile.txt").write_text(
                prof.key_averages().table(sort_by="cuda_time_total", row_limit=40)
            )
            clock.reset()
            torch.cuda.reset_peak_memory_stats()
            samples, pipeline_s = generate(image)
        else:
            samples, pipeline_s = generate(image)
        vertices = np.asarray(samples[0], dtype=np.float32)
        faces = np.ascontiguousarray(samples[1]).astype(np.int64)
        t = time.perf_counter()
        buf = io.BytesIO()
        trimesh.Trimesh(vertices, faces).export(buf, file_type="glb")
        export_s = time.perf_counter() - t
        np.savez_compressed(out / "meshes" / f"{path.stem}.npz", vertices=vertices, faces=faces)
        encode = clock.times["encode"]
        geometry = clock.times["geometry"]
        row = {
            "input": path.name,
            "pipeline_s": pipeline_s,
            "encode_s": encode,
            "denoise_s": pipeline_s - encode - geometry,
            "geometry_s": geometry,
            "decode_s": clock.times["decode"],
            "decode_calls": clock.decode_calls,
            "export_s": export_s,
            "total_s": pipeline_s + export_s,
            "torch_peak_bytes": torch.cuda.max_memory_allocated(),
            "vertices": int(len(vertices)),
            "faces": int(len(faces)),
            "glb_bytes": len(buf.getvalue()),
        }
        rows.append(row)
        print(json.dumps(row), flush=True)

    report["rows"] = rows
    report["summary"] = {
        key: _summary([r[key] for r in rows])
        for key in ("pipeline_s", "encode_s", "denoise_s", "geometry_s", "decode_s", "export_s", "total_s")
    }
    torch_peak = max(r["torch_peak_bytes"] for r in rows)
    report["peak_vram_bytes"] = report["device_used_after_load_bytes"] + (
        torch_peak - report["torch_allocated_after_load_bytes"]
    )
    report["hooks"] = {name: h.snapshot() for name, h in hooks.items()}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"summary": report["summary"], "peak_vram_bytes": report["peak_vram_bytes"]}, indent=2))
    return 0


def _load_mesh(path: Path):
    data = np.load(path)
    return data["vertices"], data["faces"]


def cmd_compare(args) -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from parity import compare, noise_floor
    from trt_policy import (
        PARITY_MAX_CHAMFER,
        PARITY_MIN_PSNR_DB,
        PARITY_MIN_SSIM,
        parity_verdict,
    )

    dir_a = Path(args.a) / "meshes"
    dir_b = Path(args.b) / "meshes"
    names = sorted(p.name for p in dir_a.glob("*.npz"))
    missing = [n for n in names if not (dir_b / n).exists()]
    if missing or not names:
        print(f"variant B is missing meshes: {missing or 'all'}", file=sys.stderr)
        return 2
    rows = []
    for name in names:
        row = {"input": name.replace(".npz", ".png"), **compare(_load_mesh(dir_a / name), _load_mesh(dir_b / name))}
        rows.append(row)
        print(json.dumps(row), flush=True)
    verdict = parity_verdict(rows)
    report = {
        "a": str(args.a),
        "b": str(args.b),
        "thresholds": {
            "max_chamfer": PARITY_MAX_CHAMFER,
            "min_psnr_db": PARITY_MIN_PSNR_DB,
            "min_ssim": PARITY_MIN_SSIM,
        },
        "rows": rows,
        "median": {k: statistics.median(r[k] for r in rows) for k in ("chamfer", "psnr", "ssim")},
        **verdict,
    }
    if args.floor:
        floors = [noise_floor(_load_mesh(dir_a / n)) for n in names[: args.floor]]
        report["noise_floor"] = {
            k: {"median": statistics.median(f[k] for f in floors), "worst": (max if k == "chamfer" else min)(f[k] for f in floors)}
            for k in ("chamfer", "psnr", "ssim")
        }
    Path(args.report).write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("passed", "worst", "median", "failures")}, indent=2))
    return 0 if verdict["passed"] else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--weights", required=True)
    run.add_argument("--inputs", required=True)
    run.add_argument("--out", required=True)
    run.add_argument("--variant", choices=("pytorch", "kvcache", "trt", "trt-kvcache"), required=True)
    run.add_argument("--engine")
    run.add_argument("--limit", type=int, default=0)
    run.add_argument("--profile", action="store_true")
    cmp = sub.add_parser("compare")
    cmp.add_argument("--a", required=True)
    cmp.add_argument("--b", required=True)
    cmp.add_argument("--report", required=True)
    cmp.add_argument("--floor", type=int, default=0, help="measure the method's noise floor on N meshes of A")
    args = parser.parse_args(argv)
    if args.cmd == "run" and args.variant.startswith("trt") and not args.engine:
        parser.error("--engine is required for the trt variants")
    return cmd_run(args) if args.cmd == "run" else cmd_compare(args)


if __name__ == "__main__":
    sys.exit(main())
