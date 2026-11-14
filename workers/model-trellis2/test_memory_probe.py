"""Unit tests for per-phase peak memory tracking.

Pure stdlib, no torch and no CUDA:

    cd workers/model-trellis2 && python3 -m pytest test_memory_probe.py -q

The phase peaks are the only record of where a TRELLIS.2 job's host memory
went before Cloud Run kills it, so a wrong attribution sends the next fix to the
wrong stage.
"""

from instance_health import MemorySample
from memory_probe import GIB, PhasePeaks


class FakeReader:
    def __init__(self, value_gib: float = 10.0):
        self.value = value_gib

    def __call__(self):
        return MemorySample(int(self.value * GIB), 32 * GIB, "cgroup2")


def test_records_the_highest_sample_inside_each_phase():
    reader = FakeReader(10)
    probe = PhasePeaks(reader)
    with probe.phase("sampling"):
        reader.value = 18
        probe.sample()
        reader.value = 12
    with probe.phase("to_glb"):
        reader.value = 25
        probe.sample()
        reader.value = 14
    assert probe.peaks() == {"sampling": 18 * GIB, "to_glb": 25 * GIB}


def test_nested_phases_lift_the_outer_peak():
    reader = FakeReader(10)
    probe = PhasePeaks(reader)
    with probe.phase("run"):
        with probe.phase("decode"):
            reader.value = 27
            probe.sample()
        reader.value = 11
    peaks = probe.peaks()
    assert peaks["decode"] == 27 * GIB
    assert peaks["run"] == 27 * GIB


def test_a_phase_shorter_than_the_interval_is_still_measured():
    probe = PhasePeaks(FakeReader(9), interval=60)
    with probe.phase("instant"):
        pass
    assert probe.peaks() == {"instant": 9 * GIB}


def test_unreadable_memory_reports_not_measured():
    probe = PhasePeaks(lambda: None)
    with probe.phase("run"):
        probe.sample()
    assert probe.peaks() == {}
    assert probe.describe() == "memory peaks: not measured"


def test_describe_names_the_highest_phase():
    reader = FakeReader(10)
    probe = PhasePeaks(reader)
    with probe.phase("sampling"):
        reader.value = 20
        probe.sample()
    with probe.phase("to_glb"):
        reader.value = 30
        probe.sample()
    assert probe.describe() == (
        "memory peaks (GiB of 32.0, cgroup2): sampling 20.0, to_glb 30.0; highest in to_glb"
    )


def test_wrap_runs_a_method_inside_its_phase_and_only_once():
    reader = FakeReader(10)
    probe = PhasePeaks(reader)

    class Pipeline:
        def decode_latent(self, x):
            reader.value = 22
            probe.sample()
            return x * 2

    pipe = Pipeline()
    assert probe.wrap(pipe, "decode_latent", "decode") is True
    assert probe.wrap(pipe, "decode_latent", "decode") is False
    assert probe.wrap(pipe, "missing") is False
    assert pipe.decode_latent(3) == 6
    assert probe.peaks() == {"decode": 22 * GIB}


def test_reset_forgets_finished_phases():
    probe = PhasePeaks(FakeReader(10))
    with probe.phase("old"):
        pass
    probe.reset()
    assert probe.peaks() == {}


def test_background_thread_samples_while_a_phase_runs():
    import time

    reader = FakeReader(10)
    probe = PhasePeaks(reader, interval=0.01)
    probe.start()
    try:
        with probe.phase("long"):
            reader.value = 26
            deadline = time.time() + 2
            while probe.peaks().get("long", 0) < 26 * GIB and time.time() < deadline:
                time.sleep(0.01)
            reader.value = 10
    finally:
        probe.stop()
    assert probe.peaks()["long"] == 26 * GIB


def test_on_exit_reports_each_finished_phase_with_its_peak():
    reader = FakeReader(10)
    seen = []
    probe = PhasePeaks(reader, on_exit=lambda name, peak: seen.append((name, peak)))
    with probe.phase("run"):
        with probe.phase("decode"):
            reader.value = 21
            probe.sample()
    assert seen == [("decode", 21 * GIB), ("run", 21 * GIB)]
