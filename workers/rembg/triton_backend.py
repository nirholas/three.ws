"""Run rembg's models on NVIDIA Triton Inference Server instead of in-process.

rembg's session classes do their own pre- and post-processing (resize,
normalise, mask resample) in Python and touch the network through exactly two
calls: ``inner_session.get_inputs()[0].name`` and
``inner_session.run(None, feeds)[0]``. ``TritonInnerSession`` answers those two
calls by sending the tensor to Triton over gRPC, so every byte of rembg's
image handling stays identical and only the forward pass moves to the GPU,
where Triton's dynamic batcher stacks concurrent requests into one execution.

The metrics exporter scrapes Triton's Prometheus endpoint once a minute and
writes per-model rates (requests, executions, mean batch size, queue and
compute time) plus GPU utilisation and memory to Cloud Monitoring as
``custom.googleapis.com/triton/*``.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Iterable, Optional

import numpy as np

log = logging.getLogger("rembg.triton")

TRITON_GRPC_URL = os.environ.get("TRITON_GRPC_URL", "127.0.0.1:8001")
TRITON_METRICS_URL = os.environ.get("TRITON_METRICS_URL", "http://127.0.0.1:8002/metrics")
METRIC_PREFIX = "custom.googleapis.com/triton/"


class TritonInnerSession:
    """The two-call subset of ``onnxruntime.InferenceSession`` rembg uses."""

    def __init__(self, client, model: str, input_name: str, output_name: str):
        self._client = client
        self._model = model
        self._input_name = input_name
        self._output_name = output_name

    def get_inputs(self):
        return [SimpleNamespace(name=self._input_name)]

    def get_providers(self):
        return ["TritonInferenceServer"]

    def run(self, output_names, feeds: dict):
        from tritonclient.grpc import InferInput, InferRequestedOutput

        tensor = np.ascontiguousarray(feeds[self._input_name], dtype=np.float32)
        infer_input = InferInput(self._input_name, list(tensor.shape), "FP32")
        infer_input.set_data_from_numpy(tensor)
        result = self._client.infer(
            self._model,
            inputs=[infer_input],
            outputs=[InferRequestedOutput(self._output_name)],
        )
        return [result.as_numpy(self._output_name)]


def make_client(url: str = TRITON_GRPC_URL):
    """One gRPC client for the process; its inference calls are thread-safe."""
    from tritonclient.grpc import InferenceServerClient

    return InferenceServerClient(url=url)


def build_session(client, model_name: str):
    """A real rembg session object for ``model_name`` whose forward pass runs
    on Triton. The tensor names come from Triton's own model metadata, so a
    config and its exported graph can never disagree silently."""
    from rembg.sessions import sessions_class

    session_cls = next((c for c in sessions_class if c.name() == model_name), None)
    if session_cls is None:
        raise ValueError(f"rembg has no session class for {model_name!r}")
    meta = client.get_model_metadata(model_name)
    session = session_cls.__new__(session_cls)
    session.model_name = model_name
    session.inner_session = TritonInnerSession(
        client, model_name, meta.inputs[0].name, meta.outputs[0].name
    )
    return session


def wait_until_ready(client, models: Iterable[str], timeout_s: float = 600.0) -> None:
    """Block until Triton is live and every model has loaded (and warmed up)."""
    deadline = time.monotonic() + timeout_s
    pending = list(models)
    while True:
        try:
            if client.is_server_live():
                pending = [m for m in pending if not client.is_model_ready(m)]
                if not pending:
                    return
        except Exception as exc:  # gRPC UNAVAILABLE while tritonserver boots
            log.debug("triton not reachable yet: %s", exc)
        if time.monotonic() > deadline:
            raise TimeoutError(f"Triton models not ready after {timeout_s:.0f}s: {pending}")
        time.sleep(1.0)


def model_ready_states(client, models: Iterable[str]) -> dict:
    states = {}
    for model in models:
        try:
            states[model] = bool(client.is_model_ready(model))
        except Exception:
            states[model] = False
    return states


# ── metrics ─────────────────────────────────────────────────────────────────

# Triton counter name -> short key used in the snapshot.
_COUNTERS = {
    "nv_inference_request_success": "requests",
    "nv_inference_request_failure": "failures",
    "nv_inference_count": "inferences",
    "nv_inference_exec_count": "executions",
    "nv_inference_queue_duration_us": "queue_us",
    "nv_inference_compute_infer_duration_us": "compute_us",
}
_GPU_GAUGES = {
    "nv_gpu_utilization": "gpu_utilization",
    "nv_gpu_memory_used_bytes": "gpu_memory_used_bytes",
    "nv_gpu_memory_total_bytes": "gpu_memory_total_bytes",
}


@dataclass
class Snapshot:
    at: float
    models: dict  # model -> {key: cumulative counter value}
    gpu: dict  # gauge key -> value (summed across GPUs; one L4 per instance)


def parse_metrics(text: str, at: Optional[float] = None) -> Snapshot:
    """Parse Triton's Prometheus exposition into cumulative per-model counters."""
    from prometheus_client.parser import text_string_to_metric_families

    models: dict = {}
    gpu: dict = {}
    for family in text_string_to_metric_families(text):
        for sample in family.samples:
            name = sample.name
            # The parser reports counter samples with a "_total" suffix that
            # Triton's own exposition does not carry.
            if name.endswith("_total") and name[: -len("_total")] in _COUNTERS:
                name = name[: -len("_total")]
            if name in _COUNTERS and "model" in sample.labels:
                bucket = models.setdefault(sample.labels["model"], {})
                key = _COUNTERS[name]
                bucket[key] = bucket.get(key, 0.0) + float(sample.value)
            elif name in _GPU_GAUGES:
                key = _GPU_GAUGES[name]
                gpu[key] = gpu.get(key, 0.0) + float(sample.value)
    return Snapshot(at=time.time() if at is None else at, models=models, gpu=gpu)


def summarize(prev: Snapshot, cur: Snapshot) -> dict:
    """Per-interval rates between two snapshots.

    Returns ``{"models": {model: {...}}, "gpu": {...}}`` where each model has
    requests_per_min, executions_per_min, avg_batch_size, avg_queue_ms and
    avg_compute_ms. A counter that went backwards (Triton restarted) is
    treated as starting from zero.
    """
    minutes = max(cur.at - prev.at, 1e-9) / 60.0
    out = {"models": {}, "gpu": dict(cur.gpu)}
    for model, now in cur.models.items():
        before = prev.models.get(model, {})

        def delta(key):
            a, b = before.get(key, 0.0), now.get(key, 0.0)
            return b if b < a else b - a

        requests, executions = delta("requests"), delta("executions")
        inferences = delta("inferences")
        out["models"][model] = {
            "requests_per_min": requests / minutes,
            "executions_per_min": executions / minutes,
            "avg_batch_size": inferences / executions if executions else 0.0,
            "avg_queue_ms": delta("queue_us") / requests / 1000.0 if requests else 0.0,
            "avg_compute_ms": delta("compute_us") / executions / 1000.0 if executions else 0.0,
            "failures_per_min": delta("failures") / minutes,
        }
    return out


def scrape(url: str = TRITON_METRICS_URL) -> Snapshot:
    import httpx

    resp = httpx.get(url, timeout=10.0)
    resp.raise_for_status()
    return parse_metrics(resp.text)


def scrape_gpu_gauges() -> dict:
    """Current GPU gauges (empty when Triton runs without a GPU)."""
    return scrape().gpu


class MetricsExporter(threading.Thread):
    """Daemon thread: scrape Triton every ``interval_s``, write Cloud Monitoring."""

    def __init__(self, project: str, location: str, service: str, interval_s: float = 60.0):
        super().__init__(name="triton-metrics", daemon=True)
        self.project = project
        self.location = location
        self.service = service
        self.interval_s = interval_s
        self.instance = f"{os.environ.get('K_REVISION', service)}-{socket.gethostname()}"
        self.last_summary: Optional[dict] = None
        self.last_error: Optional[str] = None
        self._client = None

    def _write(self, summary: dict, at: float) -> None:
        from google.cloud import monitoring_v3

        if self._client is None:
            self._client = monitoring_v3.MetricServiceClient()
        resource = {
            "type": "generic_task",
            "labels": {
                "project_id": self.project,
                "location": self.location,
                "namespace": "rembg-triton",
                "job": self.service,
                "task_id": self.instance,
            },
        }
        seconds = int(at)
        interval = monitoring_v3.TimeInterval(
            {"end_time": {"seconds": seconds, "nanos": int((at - seconds) * 1e9)}}
        )

        def point(metric: str, labels: dict, value: float):
            series = monitoring_v3.TimeSeries()
            series.metric.type = METRIC_PREFIX + metric
            series.metric.labels.update(labels)
            series.resource.type = resource["type"]
            series.resource.labels.update(resource["labels"])
            series.points = [monitoring_v3.Point({"interval": interval, "value": {"double_value": float(value)}})]
            return series

        series = [point(key, {}, value) for key, value in summary["gpu"].items()]
        for model, stats in summary["models"].items():
            series.extend(point(key, {"model": model}, value) for key, value in stats.items())
        # The API takes at most 200 series per call.
        for start in range(0, len(series), 200):
            self._client.create_time_series(
                name=f"projects/{self.project}", time_series=series[start : start + 200]
            )

    def run(self) -> None:
        prev: Optional[Snapshot] = None
        while True:
            try:
                cur = scrape()
                if prev is not None:
                    summary = summarize(prev, cur)
                    self._write(summary, cur.at)
                    self.last_summary = summary
                    self.last_error = None
                prev = cur
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("triton metrics export failed: %s", self.last_error)
            time.sleep(self.interval_s)
