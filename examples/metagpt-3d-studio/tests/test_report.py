"""How a run ends when three.ws refuses a call part-way through.

    python3 -m unittest discover -s tests        (from examples/metagpt-3d-studio)

Standard library only and no network. These pin the second failure of
2026-11-27: iteration 1 generated a chair and the Reviewer failed it, then
iteration 2 met the account's hourly generation limit. The run printed a
MetaGPT stack trace, reported "no model delivered" and dropped the chair it
had already made.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402

RATE_LIMITED = {
    "code": -32000,
    "message": "Rate limited: the free 3D studio allows 30 generations per hour for this three.ws account, and that limit is used up. "
    "It resets at 2026-11-27T22:00:00.000Z (in 761 s).",
    "data": {"reason": "rate_limited", "limit": "generation_hourly", "max": 30, "retry_after": 761},
}

CHAIR = {
    "title": "low-poly wooden chair",
    "url": "https://three.ws/cdn/forge/u/chair.glb",
    "viewer_url": "https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fu%2Fchair.glb",
    "source": "forge_free",
}


class Response:
    """What urllib.request.urlopen hands back, for one JSON body."""

    def __init__(self, body: dict) -> None:
        self.headers = {"mcp-session-id": "s1"}
        self._body = json.dumps(body).encode()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> bool:
        return False


def review(passed: bool, model: dict | None, fault: str = "") -> dict:
    return {"pass": passed, "fault": fault, "points": {"subject": "It is a chair."} if model else {}, "model": model}


def finished_run(**state) -> main.Run:
    run = main.Run(main.Studio())
    for key, value in state.items():
        setattr(run, key, value)
    return run


def report(run: main.Run) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main.report(run)
    return code, out.getvalue(), err.getvalue()


class RefusalTest(unittest.TestCase):
    def test_a_refused_call_raises_the_servers_own_sentence(self) -> None:
        studio = main.Studio()
        with mock.patch.object(main.urllib.request, "urlopen", return_value=Response({"jsonrpc": "2.0", "id": 1, "error": RATE_LIMITED})):
            with self.assertRaises(main.StudioError) as caught:
                studio.call("forge_free", {"prompt": "a chair"})
        message = str(caught.exception)
        self.assertIn("30 generations per hour", message)
        self.assertIn("resets at 2026-11-27T22:00:00.000Z", message)
        self.assertNotIn("'code'", message, "the raw JSON-RPC error object is not a message")
        self.assertEqual(caught.exception.data["reason"], "rate_limited")
        self.assertEqual(caught.exception.data["retry_after"], 761)

    def test_a_role_failure_is_one_line_and_never_a_stack_trace(self) -> None:
        text = main.fault_text(main.StudioError("three.ws refused tools/call: Rate limited.", {"reason": "rate_limited"}))
        self.assertEqual(text, "three.ws refused tools/call: Rate limited.")
        wrapped = Exception("Traceback (most recent call last):\n  File \"main.py\", line 94, in rpc\nRuntimeError: the real reason")
        self.assertEqual(main.fault_text(wrapped), "RuntimeError: the real reason")
        self.assertEqual(main.fault_text(ValueError("Grok did not answer with JSON")), "ValueError: Grok did not answer with JSON")


class ReportTest(unittest.TestCase):
    def test_a_model_made_before_the_refusal_is_still_delivered(self) -> None:
        run = finished_run(
            iteration=1,
            llm_calls=4,
            delivered=review(False, CHAIR, "24,654 triangles is far too dense for a low-poly chair"),
            error="Modeler failed: three.ws refused tools/call: Rate limited: the free 3D studio allows 30 generations per hour",
        )
        code, out, err = report(run)
        self.assertEqual(code, main.EXIT_REVIEW_FAILED)
        self.assertIn("30 generations per hour", err)
        self.assertNotIn("no model delivered", err)
        self.assertIn("verdict  FAIL", out)
        self.assertIn("24,654 triangles", out)
        self.assertIn(f"GLB:     {CHAIR['url']}", out)

    def test_a_later_iteration_with_no_model_falls_back_to_the_reviewed_one(self) -> None:
        busy = "forge_free did not finish: Generation failed: The 3D generator is busy right now."
        run = finished_run(iteration=2, llm_calls=5, delivered=review(False, CHAIR, "too dense"), final=review(False, None, busy))
        code, out, err = report(run)
        self.assertEqual(code, main.EXIT_REVIEW_FAILED)
        self.assertIn("busy right now", err)
        self.assertIn(f"GLB:     {CHAIR['url']}", out)

    def test_no_model_at_all_is_a_failure(self) -> None:
        run = finished_run(iteration=1, error="Modeler failed: three.ws refused tools/call: Rate limited.")
        code, out, err = report(run)
        self.assertEqual(code, main.EXIT_FAILED)
        self.assertIn("no model delivered: Modeler failed: three.ws refused tools/call: Rate limited.", err)
        self.assertNotIn("GLB:", out)

    def test_a_passed_review_exits_zero(self) -> None:
        passed = review(True, CHAIR)
        run = finished_run(iteration=1, llm_calls=3, delivered=passed, final=passed)
        code, out, err = report(run)
        self.assertEqual(code, main.EXIT_OK)
        self.assertIn("verdict  PASS after 1 of 2 iterations (3 Grok calls)", out)
        self.assertEqual(err, "")


if __name__ == "__main__":
    unittest.main()
