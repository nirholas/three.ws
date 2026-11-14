"""Per-phase peak host memory for one TRELLIS.2 job.

Pure stdlib (no torch, no CUDA), so it is unit tested anywhere
(test_memory_probe.py) and main.py only wires it in.

Why: Cloud Run kills a container that crosses its memory ceiling with signal 9,
and a kill writes nothing. The before/after samples instance_health logs say
how much a job left behind, not which step crossed the line. This module polls
the same reading instance_health uses, on a background thread, and records the
highest value seen while each named phase was running, so the log line written
after every job (or the last one written before a kill) names the phase that
peaked.
"""

from __future__ import annotations

import functools
import threading
from contextlib import contextmanager
from typing import Callable, Iterator, Optional

from instance_health import MemorySample, read_memory

GIB = 1024 ** 3


class PhasePeaks:
    """Peak memory per phase, sampled every `interval` seconds while active.

    Phases nest: a sample counts toward every phase on the stack, so a sampling
    stage inside the pipeline run reports its own peak and also lifts the run's.
    Not reentrant across threads: one job at a time (MAX_CONCURRENT=1) owns it.
    """

    def __init__(
        self,
        reader: Callable[[], Optional[MemorySample]] = read_memory,
        interval: float = 0.1,
        on_exit: Optional[Callable[[str, int], None]] = None,
    ) -> None:
        self._reader = reader
        self._on_exit = on_exit
        self._interval = interval
        self._lock = threading.Lock()
        self._stack: list[str] = []
        self._order: list[str] = []
        self._peaks: dict[str, int] = {}
        self._limit = 0
        self._source = ""
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def sample(self) -> None:
        """Read memory once and credit it to every active phase."""
        reading = self._reader()
        if reading is None:
            return
        with self._lock:
            self._limit, self._source = reading.limit_bytes, reading.source
            for name in self._stack:
                if reading.used_bytes > self._peaks.get(name, -1):
                    self._peaks[name] = reading.used_bytes

    @contextmanager
    def phase(self, name: str) -> Iterator[None]:
        with self._lock:
            self._stack.append(name)
            if name not in self._peaks:
                self._order.append(name)
                self._peaks[name] = -1
        # Sample on entry and exit as well as on the timer, so a phase shorter
        # than one interval still records a value.
        self.sample()
        try:
            yield
        finally:
            self.sample()
            with self._lock:
                # Remove the innermost occurrence: phases always close in order.
                for i in range(len(self._stack) - 1, -1, -1):
                    if self._stack[i] == name:
                        del self._stack[i]
                        break
                peak = self._peaks.get(name, -1)
            # A kill writes nothing, so a line per finished phase is what shows
            # how far the job got before the ceiling.
            if self._on_exit is not None and peak >= 0:
                self._on_exit(name, peak)

    def wrap(self, obj: object, method: str, name: Optional[str] = None) -> bool:
        """Run `obj.method` inside a phase. False when obj has no such method."""
        original = getattr(obj, method, None)
        if not callable(original) or getattr(original, "_memory_phase", None):
            return False
        label = name or method

        @functools.wraps(original)
        def wrapped(*args, **kwargs):
            with self.phase(label):
                return original(*args, **kwargs)

        wrapped._memory_phase = label  # type: ignore[attr-defined]
        setattr(obj, method, wrapped)
        return True

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="memory-probe", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            self.sample()

    def reset(self) -> None:
        with self._lock:
            self._order = [n for n in self._stack]
            self._peaks = {n: -1 for n in self._stack}

    def peaks(self) -> dict[str, int]:
        """Phase name to peak bytes, in first-entered order; unmeasured phases omitted."""
        with self._lock:
            return {n: self._peaks[n] for n in self._order if self._peaks.get(n, -1) >= 0}

    def describe(self) -> str:
        peaks = self.peaks()
        if not peaks:
            return "memory peaks: not measured"
        with self._lock:
            limit, source = self._limit, self._source
        parts = [f"{name} {value / GIB:.1f}" for name, value in peaks.items()]
        top = max(peaks, key=peaks.get)
        return (
            f"memory peaks (GiB of {limit / GIB:.1f}, {source}): "
            + ", ".join(parts)
            + f"; highest in {top}"
        )

