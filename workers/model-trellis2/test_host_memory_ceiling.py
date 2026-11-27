"""The worker never starts a resolution its host RAM is measured not to hold.

Regression for the two orphaned standard-tier jobs of 2026-11-11 (forge_creations
90092d55 and bebe4ca5) and the lab runs the same day: on the production shape
(Cloud Run, 8 vCPU, 32 GiB, one L4) a 1024 or 1536 job finishes all three
sampling stages and is then killed with signal 9 in decode and to_glb. A host-RAM
kill skips the CUDA out-of-memory step-down, writes nothing, and leaves the
caller waiting minutes for a job the platform then records as orphaned. The 512
job on the same image peaked at 27.1 of 32 GiB (model-trellis2 log, 2026-11-20,
task c558f462), so 512 is the largest resolution that host can finish.

Imports main.py, which needs torch, FastAPI, PIL and google-cloud-storage but no
GPU, no weights and no TRELLIS.2 tree:

    cd workers/model-trellis2 && python3 -m pytest test_host_memory_ceiling.py -q
"""

import os

os.environ.setdefault("API_KEY", "host-ceiling-test-key")
os.environ.setdefault("GCS_BUCKET", "host-ceiling-test-bucket")

import pytest
from fastapi.testclient import TestClient

import main
from instance_health import MemorySample

GIB = 1024 ** 3


def host(limit_gib):
    """A read_memory() stand-in for an instance with this memory ceiling."""
    if limit_gib is None:
        return lambda: None
    sample = MemorySample(used_bytes=int(16.9 * GIB), limit_bytes=int(limit_gib * GIB), source="cgroup1")
    return lambda: sample


@pytest.fixture
def production_l4(monkeypatch):
    monkeypatch.setattr(main, "read_memory", host(32))
    monkeypatch.setattr(main, "MAX_RESOLUTION", 1536)


@pytest.mark.parametrize("tier", ["draft", "standard", "high", "max", None])
def test_every_tier_on_the_32_gib_host_runs_at_512(production_l4, tier):
    assert main._served_resolution(None, tier) == 512


@pytest.mark.parametrize("resolution", [1024, 1536, 2048])
def test_an_explicit_high_resolution_steps_down_on_the_32_gib_host(production_l4, resolution):
    assert main._served_resolution(resolution, None) == 512


def test_a_host_with_more_ram_keeps_the_tier_mapping(monkeypatch):
    monkeypatch.setattr(main, "read_memory", host(64))
    monkeypatch.setattr(main, "MAX_RESOLUTION", 1536)
    assert main._served_resolution(None, "draft") == 512
    assert main._served_resolution(None, "standard") == 1024
    assert main._served_resolution(None, "max") == 1536


def test_unreadable_memory_keeps_the_tier_mapping(monkeypatch):
    # No cgroup and no /proc/meminfo: unknown is not evidence of a small host.
    monkeypatch.setattr(main, "read_memory", host(None))
    monkeypatch.setattr(main, "MAX_RESOLUTION", 1536)
    assert main._served_resolution(None, "standard") == 1024


def test_the_env_ceiling_still_applies_on_a_large_host(monkeypatch):
    monkeypatch.setattr(main, "read_memory", host(128))
    monkeypatch.setattr(main, "MAX_RESOLUTION", 1024)
    assert main._served_resolution(None, "max") == 1024


def test_health_advertises_only_what_the_host_can_finish(production_l4):
    # The platform probe and the TRELLIS.2 lab read these fields, so a 32 GiB
    # instance must not offer 1024 or 1536 it would be killed running.
    body = TestClient(main.app).get("/health").json()
    assert body["resolutions"] == [512]
    assert body["default_resolution"] == 512
