"""Instance self-care for the TRELLIS worker: host memory and task liveness.

Pure stdlib, no torch and no CUDA, so every decision here is unit tested on any
machine (see test_instance_health.py) and main.py only wires it in.

Why this module exists (production, 2026-10-03 to 2026-10-08):

  * The single warm L4 instance was OOM-killed twelve times in five days
    ("Container terminated on signal 9"). Cloud Run's memory utilization for
    the revision climbed in steps after each heavy job (0.46 -> 0.56 -> 0.71 ->
    0.81 -> 0.88 -> 0.91) and never came back down, then a mesh postprocess
    (decimate, invisible-face removal, UV unwrap, texture bake) pushed it past
    the 32 GiB ceiling, which is the most memory Cloud Run gives an L4 instance.
    That is glibc keeping freed heap in per-thread arenas: the pipeline runs in
    executor threads, each of which grows its own arena, and nothing hands the
    freed pages back to the kernel.
  * Every kill took the in-flight job with it, and the queued job behind it.
    Their durable GCS records stayed "running" until a 30 minute orphan window
    expired, long after the caller's poll budget, so the forge's lane failover
    never saw a failure to act on and the user just watched a spinner.

The fixes are split by what they guard against:

  trim_heap()          returns freed heap to the kernel after every job.
  read_memory()        reports what the instance actually holds, so each job
                       logs its footprint and the recycle guard has a number.
  should_recycle()     decides when an instance has ratcheted far enough that
                       it should restart BETWEEN jobs rather than die inside one.
  vram_sample()        shapes a torch.cuda.mem_get_info() reading into the same
                       shape, so should_recycle() also catches a VRAM leak that
                       host memory can never see (main.py owns the torch call;
                       see its own mem_get_info() comment, 2026-10-24).
  task_is_orphaned()   lets a heartbeat-refreshed record expire in minutes, not
                       half an hour, once its runner is gone.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
from dataclasses import dataclass
from typing import Optional

# How often a live task refreshes its durable record, and how long a queued or
# running record may go without a refresh before it is declared orphaned. Six
# missed beats is far beyond any scheduling hiccup on a healthy instance, and
# still well inside the forge client's ~300 s poll budget, so the failure lands
# while a client is still listening and the lane failover can redispatch.
HEARTBEAT_SECS = 30.0
ORPHAN_AFTER_SECS = 180.0

# Recycle once the instance holds this share of its memory limit after a job...
RECYCLE_FRACTION = float(os.environ.get("MEMORY_RECYCLE_FRACTION", "0.80"))
# ...and only if it has grown at least this much past its post-load baseline. The
# growth floor is what stops a mismeasured or simply large baseline from turning
# into a restart after every single job.
RECYCLE_MIN_GROWTH = float(os.environ.get("MEMORY_RECYCLE_MIN_GROWTH", "0.15"))

# Same two-condition recycle rule, applied to GPU memory instead of host RAM.
# Tighter than the host-RAM pair because a VRAM OOM has no graceful fallback (it
# crashes the job outright), whereas host RAM pressure degrades first. See
# vram_sample() below: nvdiffrast's rasterizer allocates through its own
# cudaMalloc outside torch's caching allocator, so empty_cache() cannot reach
# it and an instance's usable VRAM only ever ratchets down.
VRAM_RECYCLE_FRACTION = float(os.environ.get("VRAM_RECYCLE_FRACTION", "0.90"))
VRAM_RECYCLE_MIN_GROWTH = float(os.environ.get("VRAM_RECYCLE_MIN_GROWTH", "0.10"))

_CGROUP_V2 = "/sys/fs/cgroup"
_CGROUP_V1 = "/sys/fs/cgroup/memory"
_MEMINFO = "/proc/meminfo"


@dataclass(frozen=True)
class MemorySample:
    used_bytes: int
    limit_bytes: int
    source: str

    @property
    def fraction(self) -> float:
        return self.used_bytes / self.limit_bytes if self.limit_bytes else 0.0

    def describe(self) -> str:
        gib = 1024 ** 3
        return (
            f"{self.used_bytes / gib:.1f}/{self.limit_bytes / gib:.1f} GiB "
            f"({self.fraction:.0%}, {self.source})"
        )


def _read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="ascii") as fh:
            return fh.read()
    except OSError:
        return None


def _stat_fields(text: str) -> dict[str, int]:
    fields: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            fields[parts[0].rstrip(":")] = int(parts[1])
    return fields


def _from_cgroup_v2(root: str) -> Optional[MemorySample]:
    stat, limit = _read(os.path.join(root, "memory.stat")), _read(os.path.join(root, "memory.max"))
    if stat is None or limit is None or not limit.strip().isdigit():
        return None
    fields = _stat_fields(stat)
    if "anon" not in fields:
        return None
    # anon is the process heap; shmem is tmpfs, which is where Cloud Run's
    # in-memory filesystem (and so the staged weights in /tmp) is charged.
    # Page cache is left out on purpose: the kernel reclaims it before it OOMs.
    return MemorySample(fields["anon"] + fields.get("shmem", 0), int(limit.strip()), "cgroup2")


def _from_cgroup_v1(root: str) -> Optional[MemorySample]:
    stat = _read(os.path.join(root, "memory.stat"))
    limit = _read(os.path.join(root, "memory.limit_in_bytes"))
    if stat is None or limit is None or not limit.strip().isdigit():
        return None
    fields = _stat_fields(stat)
    if "total_rss" not in fields:
        return None
    limit_bytes = int(limit.strip())
    # An unlimited v1 group reports a sentinel near 2**63; it says nothing about
    # this instance's ceiling, so defer to /proc/meminfo instead.
    if limit_bytes >= 1 << 60:
        return None
    return MemorySample(fields["total_rss"] + fields.get("total_shmem", 0), limit_bytes, "cgroup1")


def _from_meminfo(path: str) -> Optional[MemorySample]:
    text = _read(path)
    if text is None:
        return None
    fields = _stat_fields(text)
    total, available = fields.get("MemTotal"), fields.get("MemAvailable")
    if not total or available is None:
        return None
    # /proc/meminfo is in KiB. MemAvailable already discounts reclaimable cache.
    return MemorySample((total - available) * 1024, total * 1024, "meminfo")


def read_memory(
    cgroup_v2_root: str = _CGROUP_V2,
    cgroup_v1_root: str = _CGROUP_V1,
    meminfo_path: str = _MEMINFO,
) -> Optional[MemorySample]:
    """Best available view of the memory this instance holds against its limit.

    Never raises. Returns None when no source is readable, and every caller
    treats None as "unknown", which never triggers a recycle.
    """
    for reader, arg in (
        (_from_cgroup_v2, cgroup_v2_root),
        (_from_cgroup_v1, cgroup_v1_root),
        (_from_meminfo, meminfo_path),
    ):
        try:
            sample = reader(arg)
        except (ValueError, ZeroDivisionError):
            sample = None
        if sample is not None and sample.limit_bytes > 0:
            return sample
    return None


def vram_sample(free_bytes: int, total_bytes: int) -> Optional[MemorySample]:
    """Shape a torch.cuda.mem_get_info() (free, total) pair into a MemorySample.

    This module stays pure stdlib (no torch import), so the caller owns the
    `torch.cuda.is_available()` guard and the `mem_get_info()` call itself and
    passes in the two numbers it already has. Reuses MemorySample's shape
    (used_bytes, limit_bytes, source) rather than a divergent VRAM type, so
    should_recycle() applies unchanged.
    """
    if not total_bytes:
        return None
    return MemorySample(total_bytes - free_bytes, total_bytes, "cuda")


def should_recycle(
    current: Optional[MemorySample],
    baseline: Optional[MemorySample],
    threshold: float = RECYCLE_FRACTION,
    min_growth: float = RECYCLE_MIN_GROWTH,
) -> bool:
    """True when the instance should restart between jobs.

    Both conditions must hold: the instance is near its ceiling, AND it got
    there by growing since the model finished loading. Without a baseline (the
    load has not completed, or memory is unreadable) the answer is always no.
    """
    if current is None or baseline is None:
        return False
    return current.fraction >= threshold and current.fraction - baseline.fraction >= min_growth


_libc = None


def trim_heap() -> bool:
    """Hand freed heap pages back to the kernel (glibc malloc_trim).

    Returns False on a libc without malloc_trim (musl, macOS), where there is
    nothing to do. Never raises.
    """
    global _libc
    try:
        if _libc is None:
            _libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6")
        trim = getattr(_libc, "malloc_trim", None)
        if trim is None:
            return False
        trim.argtypes = [ctypes.c_size_t]
        trim.restype = ctypes.c_int
        trim(0)
        return True
    except OSError:
        return False


def task_is_orphaned(
    status: Optional[str],
    updated_at: object,
    now: float,
    orphan_after: float = ORPHAN_AFTER_SECS,
) -> bool:
    """True when a queued or running record has gone stale.

    A live runner refreshes updated_at every HEARTBEAT_SECS, so a record that
    has not moved for orphan_after seconds belongs to an instance that died.
    A record with no usable timestamp cannot prove it is alive, so it counts as
    orphaned too. Terminal and unknown statuses never are.
    """
    if status not in ("queued", "running"):
        return False
    if isinstance(updated_at, bool) or not isinstance(updated_at, (int, float)):
        return True
    return now - updated_at > orphan_after
