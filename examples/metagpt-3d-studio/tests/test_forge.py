"""The Modeler's generation leg: Studio.forge against the answers the studio server gives.

    python3 -m unittest discover -s tests        (from examples/metagpt-3d-studio)

Standard library only and no network: `Studio.call` is replaced with a script of
the server's real answer shapes, and the clock is a fake one, so a five-minute
generation runs in milliseconds. main.py imports MetaGPT only inside a team run,
so this runs on any Python 3.10+ without the example's dependencies.

The first three cases pin failures seen on 2026-11-27, when a signed-in team run
ended with no model: the free generator answered "busy, start a new generation"
and the Modeler stopped there, and the next job was still rendering when the
wait ran out.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402

BUSY = (
    "Generation failed: The 3D generator is busy right now. Try again in a few seconds. Start a new generation. "
    "Start a new generation (with a new idempotency_key if you used one); a retry is routed to a healthy engine."
)


def pending(job: str, eta: int = 30) -> dict:
    return {"data": {"status": "pending", "job_id": job, "eta_seconds": eta}, "content": [], "is_error": False}


def failed(job: str, message: str = BUSY) -> dict:
    data = {"error": True, "message": message, "status": "failed", "job_id": job, "reason": "generation_failed"}
    return {"data": data, "content": [{"type": "text", "text": message}], "is_error": True}


def done(job: str) -> dict:
    data = {"status": "done", "job_id": job, "glb_url": f"https://three.ws/cdn/forge/{job}.glb"}
    return {"data": data, "content": [], "is_error": False}


def check_failed(job: str, wait: int = 10) -> dict:
    """One status probe failed; the server says the job itself keeps running."""
    data = {"error": True, "message": "The status check timed out.", "status": "unknown", "job_id": job, "reason": "check_failed", "retryable": True, "retry_after": wait}
    return {"data": data, "content": [], "is_error": True}


class Clock:
    """time.time and time.sleep without the waiting."""

    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class ForgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = Clock()
        for name in ("time", "sleep"):
            patcher = mock.patch.object(main.time, name, getattr(self.clock, name))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.studio = main.Studio()
        self.calls: list[tuple[str, dict]] = []

    def script(self, answer) -> None:
        """`answer(name, arguments, started)` plays the server; `started` counts forge_free calls so far."""

        def call(name: str, arguments: dict) -> dict:
            self.calls.append((name, arguments))
            return answer(name, arguments, sum(1 for n, _ in self.calls if n == "forge_free"))

        self.studio.call = call

    def starts(self) -> list[dict]:
        return [args for name, args in self.calls if name == "forge_free"]

    def test_busy_generator_gets_a_new_generation_with_a_new_key(self) -> None:
        def answer(name, arguments, started):
            if name == "forge_free":
                return failed("job-1") if started == 1 else pending("job-2")
            return done(arguments["job_id"])

        self.script(answer)
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"].get("status"), "done", out["data"].get("message"))
        self.assertEqual(out["data"]["glb_url"], "https://three.ws/cdn/forge/job-2.glb")
        keys = [args["idempotency_key"] for args in self.starts()]
        self.assertEqual(len(keys), 2)
        self.assertNotEqual(keys[0], keys[1], "a repeat with the same key replays the failed job")

    def test_a_job_that_fails_while_rendering_is_started_again(self) -> None:
        def answer(name, arguments, started):
            if name == "forge_free":
                return pending(f"job-{started}")
            return failed("job-1") if arguments["job_id"] == "job-1" else done(arguments["job_id"])

        self.script(answer)
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"].get("status"), "done", out["data"].get("message"))
        self.assertEqual(len(self.starts()), 2)

    def test_waits_out_a_generation_that_takes_eight_minutes(self) -> None:
        began = self.clock.now

        def answer(name, arguments, started):
            if name == "forge_free":
                return pending("job-1")
            return done("job-1") if self.clock.now - began >= 480 else pending("job-1")

        self.script(answer)
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"].get("status"), "done", "the wait ended while the job was still rendering")
        self.assertEqual(len(self.starts()), 1, "a job that is still rendering is waited for, not started again")

    def test_a_failed_status_check_does_not_abandon_a_running_job(self) -> None:
        probes = iter([check_failed("job-1"), pending("job-1"), done("job-1")])

        def answer(name, arguments, started):
            return pending("job-1") if name == "forge_free" else next(probes)

        self.script(answer)
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"].get("status"), "done", out["data"].get("message"))
        self.assertEqual(len(self.starts()), 1)

    def test_gives_up_after_a_bounded_number_of_generations(self) -> None:
        self.script(lambda name, arguments, started: failed(f"job-{started}"))
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"]["status"], "failed")
        self.assertEqual(len(self.starts()), main.FORGE_ATTEMPTS)
        self.assertGreaterEqual(main.FORGE_ATTEMPTS, 2)
        self.assertLessEqual(main.FORGE_ATTEMPTS, 4)

    def test_a_failure_a_new_generation_cannot_fix_is_returned_at_once(self) -> None:
        message = "Sign in to make a 3D model. A three.ws account is free."
        refusal = {"data": {"error": True, "message": message, "reason": "sign_in_required"}, "content": [], "is_error": True}
        self.script(lambda name, arguments, started: refusal)
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"]["reason"], "sign_in_required")
        self.assertEqual(len(self.starts()), 1)

    def test_a_job_that_never_finishes_ends_at_the_wait_limit(self) -> None:
        began = self.clock.now
        self.script(lambda name, arguments, started: pending("job-1"))
        out = self.studio.forge("a low-poly wooden chair")
        self.assertEqual(out["data"]["status"], "pending")
        self.assertEqual(out["data"]["job_id"], "job-1")
        self.assertLessEqual(self.clock.now - began, main.FORGE_WAIT_S + 30)


if __name__ == "__main__":
    unittest.main()
