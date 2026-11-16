"""Triton metrics parsing and rate math (triton_backend.parse_metrics/summarize):

    python3 workers/rembg/test_triton_metrics.py

The exposition below is the shape Triton 2.62 serves on :8002/metrics (HELP
and TYPE lines, per-model labels, per-GPU gauges). The Docker build gate also
parses the live endpoint of the real server; this file pins the arithmetic.
"""

from __future__ import annotations

import sys

from triton_backend import parse_metrics, summarize

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


def exposition(req, inf, execs, queue_us, compute_us, util=None):
    gpu = ""
    if util is not None:
        gpu = (
            "# HELP nv_gpu_utilization GPU utilization rate [0.0 - 1.0)\n"
            "# TYPE nv_gpu_utilization gauge\n"
            f'nv_gpu_utilization{{gpu_uuid="GPU-1"}} {util}\n'
            "# HELP nv_gpu_memory_used_bytes GPU used memory, in bytes\n"
            "# TYPE nv_gpu_memory_used_bytes gauge\n"
            'nv_gpu_memory_used_bytes{gpu_uuid="GPU-1"} 6442450944\n'
        )
    return (
        "# HELP nv_inference_request_success Number of successful inference requests\n"
        "# TYPE nv_inference_request_success counter\n"
        f'nv_inference_request_success{{model="isnet-general-use",version="1"}} {req}\n'
        'nv_inference_request_success{model="u2net",version="1"} 0\n'
        "# HELP nv_inference_request_failure Number of failed inference requests\n"
        "# TYPE nv_inference_request_failure counter\n"
        'nv_inference_request_failure{model="isnet-general-use",reason="OTHER",version="1"} 0\n'
        "# HELP nv_inference_count Number of inferences performed\n"
        "# TYPE nv_inference_count counter\n"
        f'nv_inference_count{{model="isnet-general-use",version="1"}} {inf}\n'
        "# HELP nv_inference_exec_count Number of model executions performed\n"
        "# TYPE nv_inference_exec_count counter\n"
        f'nv_inference_exec_count{{model="isnet-general-use",version="1"}} {execs}\n'
        "# HELP nv_inference_queue_duration_us Cumulative inference queuing duration\n"
        "# TYPE nv_inference_queue_duration_us counter\n"
        f'nv_inference_queue_duration_us{{model="isnet-general-use",version="1"}} {queue_us}\n'
        "# HELP nv_inference_compute_infer_duration_us Cumulative compute inference duration\n"
        "# TYPE nv_inference_compute_infer_duration_us counter\n"
        f'nv_inference_compute_infer_duration_us{{model="isnet-general-use",version="1"}} {compute_us}\n'
        + gpu
    )


a = parse_metrics(exposition(100, 100, 40, 200_000, 4_000_000, util=0.31), at=1000.0)
b = parse_metrics(exposition(220, 220, 70, 380_000, 7_600_000, util=0.62), at=1060.0)

check("per-model counters parse", a.models["isnet-general-use"]["requests"] == 100, str(a.models))
check("models with zero traffic are still listed", "u2net" in a.models)
check("gpu gauges parse", abs(b.gpu["gpu_utilization"] - 0.62) < 1e-12, str(b.gpu))

s = summarize(a, b)["models"]["isnet-general-use"]
check("requests per minute", abs(s["requests_per_min"] - 120) < 1e-9, str(s))
check("executions per minute", abs(s["executions_per_min"] - 30) < 1e-9, str(s))
check("average batch size is inferences per execution", abs(s["avg_batch_size"] - 4.0) < 1e-9, str(s))
check("queue time is per request", abs(s["avg_queue_ms"] - 1.5) < 1e-9, str(s))
check("compute time is per execution", abs(s["avg_compute_ms"] - 120.0) < 1e-9, str(s))

idle = summarize(b, b)["models"]["isnet-general-use"]
check("an idle interval reports zeros, not a divide error",
      idle["avg_batch_size"] == 0.0 and idle["avg_queue_ms"] == 0.0, str(idle))

restarted = parse_metrics(exposition(10, 10, 5, 1_000, 50_000), at=1120.0)
r = summarize(b, restarted)["models"]["isnet-general-use"]
check("a Triton restart counts from zero instead of going negative",
      abs(r["requests_per_min"] - 10) < 1e-9 and r["avg_batch_size"] == 2.0, str(r))
check("no GPU means no gpu gauges", restarted.gpu == {})

print(f"\n{PASS} checks passed")
