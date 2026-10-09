"""Unit tests for instance self-care: memory reading, recycle, orphan expiry.

Pure stdlib, no torch and no CUDA, so this runs anywhere:

    cd workers/model-trellis2 && python3 -m pytest test_instance_health.py -q

These decisions run after every generation on the production instance. A wrong
memory reading either restarts a healthy instance after every job or never
restarts a bloated one, and a wrong orphan rule either fails live jobs or leaves
dead ones polling for half an hour, which is the outage this module fixed.
"""

from pathlib import Path

from instance_health import (
    HEARTBEAT_SECS,
    ORPHAN_AFTER_SECS,
    MemorySample,
    read_memory,
    should_recycle,
    task_is_orphaned,
    trim_heap,
)

GIB = 1024 ** 3


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="ascii")


# ---------------------------------------------------------------- read_memory


def test_cgroup_v2_counts_heap_and_tmpfs_but_not_page_cache(tmp_path):
    v2 = tmp_path / "v2"
    _write(v2 / "memory.stat", f"anon {20 * GIB}\nfile {9 * GIB}\nshmem {3 * GIB}\n")
    _write(v2 / "memory.max", f"{32 * GIB}\n")
    sample = read_memory(str(v2), str(tmp_path / "none"), str(tmp_path / "none"))
    assert sample == MemorySample(23 * GIB, 32 * GIB, "cgroup2")
    assert abs(sample.fraction - 23 / 32) < 1e-9


def test_cgroup_v2_without_a_limit_falls_through_to_meminfo(tmp_path):
    v2 = tmp_path / "v2"
    _write(v2 / "memory.stat", f"anon {GIB}\n")
    _write(v2 / "memory.max", "max\n")
    meminfo = tmp_path / "meminfo"
    _write(meminfo, "MemTotal:       33554432 kB\nMemAvailable:   8388608 kB\n")
    sample = read_memory(str(v2), str(tmp_path / "none"), str(meminfo))
    assert sample.source == "meminfo"
    assert sample.used_bytes == 24 * GIB
    assert sample.limit_bytes == 32 * GIB


def test_cgroup_v1_reads_rss_plus_shmem(tmp_path):
    v1 = tmp_path / "v1"
    _write(v1 / "memory.stat", f"total_rss {10 * GIB}\ntotal_cache {5 * GIB}\ntotal_shmem {2 * GIB}\n")
    _write(v1 / "memory.limit_in_bytes", f"{16 * GIB}\n")
    sample = read_memory(str(tmp_path / "none"), str(v1), str(tmp_path / "none"))
    assert sample == MemorySample(12 * GIB, 16 * GIB, "cgroup1")


def test_unlimited_cgroup_v1_is_not_a_ceiling(tmp_path):
    v1 = tmp_path / "v1"
    _write(v1 / "memory.stat", f"total_rss {GIB}\n")
    _write(v1 / "memory.limit_in_bytes", "9223372036854771712\n")
    assert read_memory(str(tmp_path / "none"), str(v1), str(tmp_path / "none")) is None


def test_nothing_readable_is_unknown_not_an_error(tmp_path):
    missing = str(tmp_path / "missing")
    assert read_memory(missing, missing, missing) is None


def test_describe_is_human_readable():
    text = MemorySample(24 * GIB, 32 * GIB, "cgroup2").describe()
    assert text == "24.0/32.0 GiB (75%, cgroup2)"


# ---------------------------------------------------------------- should_recycle


def _at(fraction: float) -> MemorySample:
    return MemorySample(int(fraction * 32 * GIB), 32 * GIB, "cgroup2")


def test_recycles_a_ratcheted_instance():
    assert should_recycle(_at(0.88), _at(0.46))


def test_leaves_a_healthy_instance_alone():
    assert not should_recycle(_at(0.60), _at(0.46))


def test_high_baseline_alone_never_recycles():
    # A baseline that already reads high (a big model, or a reading that counts
    # more than it should) must not restart the instance after every job.
    assert not should_recycle(_at(0.84), _at(0.80))


def test_unknown_memory_never_recycles():
    assert not should_recycle(None, _at(0.40))
    assert not should_recycle(_at(0.95), None)


# ---------------------------------------------------------------- task_is_orphaned


NOW = 1_800_000_000.0


def test_a_beating_task_is_alive():
    assert not task_is_orphaned("running", NOW - HEARTBEAT_SECS, NOW)
    assert not task_is_orphaned("queued", NOW - ORPHAN_AFTER_SECS + 1, NOW)


def test_a_silent_task_is_orphaned_within_minutes():
    assert task_is_orphaned("running", NOW - ORPHAN_AFTER_SECS - 1, NOW)
    # The old rule waited 1800 s; the whole point is that a client still polls.
    assert ORPHAN_AFTER_SECS <= 300
    # Several missed beats, never one, decide it.
    assert ORPHAN_AFTER_SECS >= 4 * HEARTBEAT_SECS


def test_a_record_without_a_timestamp_cannot_prove_it_is_alive():
    assert task_is_orphaned("queued", None, NOW)
    assert task_is_orphaned("running", "yesterday", NOW)
    assert task_is_orphaned("running", True, NOW)


def test_terminal_and_unknown_records_are_never_orphaned():
    for status in ("done", "failed", None, "weird"):
        assert not task_is_orphaned(status, NOW - 10 * ORPHAN_AFTER_SECS, NOW)


# ---------------------------------------------------------------- trim_heap


def test_trim_heap_never_raises():
    assert trim_heap() in (True, False)
