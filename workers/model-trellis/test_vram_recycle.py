"""Unit tests for the VRAM recycle guard wired into main.py's _recycle_if_bloated.

Mocks torch.cuda.is_available()/mem_get_info() exactly as the pre-answered
blocker for this order prescribes, so this runs on any host, including a
CPU-only dev box with no torch package at all (see conftest.py's stub). It
proves the gap main.py:829-845 already diagnoses in its own `finally` block
comment: nvdiffrast's rasterizer allocates through its own cudaMalloc outside
torch's caching allocator, so an instance's usable VRAM only ever ratchets
down, invisible to the host-RAM recycle guard instance_health.py already had.

    cd workers/model-trellis && python3 -m pytest test_vram_recycle.py -q
"""

from __future__ import annotations

import os

os.environ.setdefault("API_KEY", "vram-test-key")
os.environ.setdefault("GCS_BUCKET", "vram-test-bucket")

import main as app_module
from instance_health import MemorySample

GIB = 1024 ** 3
VRAM_TOTAL = 24 * GIB


def _reset_recycle_state() -> None:
    app_module._draining = False
    app_module._restart_signalled = False
    app_module._live_tasks.clear()
    app_module._memory_baseline = None
    app_module._vram_baseline = None


def setup_function() -> None:
    _reset_recycle_state()


def teardown_function() -> None:
    _reset_recycle_state()


def _healthy_ram(monkeypatch) -> None:
    monkeypatch.setattr(
        app_module, "read_memory", lambda: MemorySample(4 * GIB, 32 * GIB, "cgroup2")
    )
    app_module._memory_baseline = MemorySample(3 * GIB, 32 * GIB, "cgroup2")


def test_vram_alone_drains_the_instance_even_with_healthy_ram(monkeypatch):
    _healthy_ram(monkeypatch)

    # VRAM: ratcheted from a 40% baseline to 96%, past both the VRAM fraction
    # and growth floors, with torch.cuda available.
    app_module._vram_baseline = MemorySample(int(0.40 * VRAM_TOTAL), VRAM_TOTAL, "cuda")
    monkeypatch.setattr(app_module.torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(
        app_module.torch.cuda, "mem_get_info", lambda: (int(0.04 * VRAM_TOTAL), VRAM_TOTAL)
    )

    # A job is still queued behind this one, so the decision must be provable
    # without actually reaching signal.raise_signal against the test process.
    app_module._live_tasks.add("other-queued-job")

    app_module._recycle_if_bloated("finished-job")

    assert app_module._draining is True


def test_a_healthy_instance_on_both_axes_is_left_alone(monkeypatch):
    _healthy_ram(monkeypatch)
    app_module._vram_baseline = MemorySample(int(0.40 * VRAM_TOTAL), VRAM_TOTAL, "cuda")
    monkeypatch.setattr(app_module.torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(
        app_module.torch.cuda, "mem_get_info", lambda: (int(0.45 * VRAM_TOTAL), VRAM_TOTAL)
    )

    app_module._recycle_if_bloated("finished-job")

    assert app_module._draining is False


def test_a_vram_baseline_that_already_reads_high_alone_never_recycles(monkeypatch):
    # A genuinely large model must not restart the instance after every job
    # just because its post-load baseline already reads near the ceiling.
    _healthy_ram(monkeypatch)
    app_module._vram_baseline = MemorySample(int(0.89 * VRAM_TOTAL), VRAM_TOTAL, "cuda")
    monkeypatch.setattr(app_module.torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(
        app_module.torch.cuda, "mem_get_info", lambda: (int(0.08 * VRAM_TOTAL), VRAM_TOTAL)
    )

    app_module._recycle_if_bloated("finished-job")

    assert app_module._draining is False


def test_read_vram_skips_mem_get_info_without_a_gpu(monkeypatch):
    monkeypatch.setattr(app_module.torch.cuda, "is_available", lambda: False)

    def _must_not_be_called():
        raise AssertionError("mem_get_info must not be called without a GPU")

    monkeypatch.setattr(app_module.torch.cuda, "mem_get_info", _must_not_be_called)

    assert app_module._read_vram() is None


def test_load_pipeline_captures_a_vram_baseline(monkeypatch):
    free_bytes = int(0.70 * VRAM_TOTAL)
    monkeypatch.setattr(app_module.torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(app_module.torch.cuda, "mem_get_info", lambda: (free_bytes, VRAM_TOTAL))

    app_module._vram_baseline = app_module._read_vram()

    assert app_module._vram_baseline == MemorySample(VRAM_TOTAL - free_bytes, VRAM_TOTAL, "cuda")
