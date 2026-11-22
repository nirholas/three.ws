"""Stage-subprocess runner for the model-pano2splat pipeline.

The three stage packages (pano_stitch, pano_sfm, splat_train) are standalone CLIs
that speak contract C1: JSON-line progress on stdout, a one-line JSON error on
stderr and an exit code of 0 (ok), 1 (internal), 2 (unsupported input),
3 (corrupt input) or 4 (reconstruction quality failure). Nothing here imports a
stage module; every call is a subprocess in its own process group so a cancel or
a timeout can take down the stage and everything it spawned (ffmpeg, colmap).
"""

from __future__ import annotations

import collections
import json
import logging
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger("pano2splat.stages")

STAGES_DIR = Path(os.environ.get("STAGES_DIR", Path(__file__).resolve().parent))

# Generous wall-clock ceilings. They exist so a hung stage cannot hold the GPU
# forever, not to bound normal work; STAGE_TIMEOUT_<NAME>_S overrides each.
DEFAULT_TIMEOUTS_S = {"pano_stitch": 3 * 3600, "pano_sfm": 3 * 3600, "splat_train": 4 * 3600}

EXIT_MEANING = {
    1: "internal_error",
    2: "unsupported_input",
    3: "corrupt_input",
    4: "quality_failure",
}

TERM_GRACE_S = 10.0


class StageError(Exception):
    """A stage failed. ``code`` and ``message`` are surfaced to the caller unchanged."""

    def __init__(self, code: str, message: str, exit_code: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code


class Cancelled(Exception):
    """The task was cancelled while a stage was running."""


def stage_timeout_s(module: str) -> float:
    override = os.environ.get(f"STAGE_TIMEOUT_{module.upper()}_S")
    if override:
        return float(override)
    return float(DEFAULT_TIMEOUTS_S[module])


def stage_installed(module: str) -> bool:
    pkg = STAGES_DIR / module
    return (pkg / "__main__.py").is_file()


def stage_python(module: str) -> str:
    """Interpreter for a stage. Stages whose pinned dependencies conflict (numpy 1 vs 2, opencv 4
    vs 5) each get their own venv at STAGE_VENVS_DIR/<module> (built by the Dockerfile); otherwise
    the service interpreter runs them."""
    override = os.environ.get("STAGE_PYTHON_" + module.upper())
    if override:
        return override
    candidate = Path(os.environ.get("STAGE_VENVS_DIR", "/opt/stages")) / module / "bin" / "python"
    return str(candidate) if candidate.is_file() else sys.executable


def stage_env() -> dict:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = os.pathsep.join(p for p in (str(STAGES_DIR), existing) if p)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _last_json_line(lines) -> Optional[dict]:
    for line in reversed(list(lines)):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and "error" in obj:
            return obj
    return None


class StageRunner:
    """Runs one stage subprocess at a time and can kill it from another thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self._cancelled = False

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
            proc = self._proc
        if proc is not None:
            self._kill_group(proc)

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    @staticmethod
    def _kill_group(proc: subprocess.Popen) -> None:
        try:
            pgid = os.getpgid(proc.pid)
        except ProcessLookupError:
            return
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=TERM_GRACE_S)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def run(
        self,
        module: str,
        args: list[str],
        on_progress: Callable[[Optional[str], float], None],
    ) -> None:
        """Run ``python -m <module> <args>``; raise StageError or Cancelled on failure."""
        if not stage_installed(module):
            raise StageError(
                "stage_missing",
                f"The {module} stage is not installed in this worker image.",
            )
        cmd = [stage_python(module), "-m", module, *args]
        log.info("stage start: %s", " ".join(cmd))
        with self._lock:
            if self._cancelled:
                raise Cancelled()
            proc = subprocess.Popen(
                cmd,
                cwd=str(STAGES_DIR),
                env=stage_env(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
            self._proc = proc

        stderr_tail: collections.deque[str] = collections.deque(maxlen=200)

        def drain_stderr() -> None:
            for line in proc.stderr:  # type: ignore[union-attr]
                stderr_tail.append(line.rstrip("\n"))
                log.info("%s stderr: %s", module, line.rstrip("\n")[:500])

        drain = threading.Thread(target=drain_stderr, daemon=True)
        drain.start()

        timed_out = threading.Event()

        def on_timeout() -> None:
            timed_out.set()
            self._kill_group(proc)

        timer = threading.Timer(stage_timeout_s(module), on_timeout)
        timer.daemon = True
        timer.start()
        try:
            for line in proc.stdout:  # type: ignore[union-attr]
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    log.info("%s stdout: %s", module, line[:500])
                    continue
                if isinstance(msg, dict) and "progress" in msg:
                    try:
                        frac = min(1.0, max(0.0, float(msg["progress"])))
                    except (TypeError, ValueError):
                        continue
                    stage = msg.get("stage")
                    on_progress(stage if isinstance(stage, str) else None, frac)
            code = proc.wait()
        finally:
            timer.cancel()
            if proc.poll() is None:
                self._kill_group(proc)
            drain.join(timeout=5)
            with self._lock:
                self._proc = None

        if self._cancelled:
            raise Cancelled()
        if timed_out.is_set():
            raise StageError(
                "stage_timeout",
                f"The {module} stage ran longer than {int(stage_timeout_s(module) // 60)} minutes and was stopped.",
                code,
            )
        if code != 0:
            err = _last_json_line(stderr_tail)
            if err is not None:
                raise StageError(str(err.get("error")), str(err.get("message", "")), code)
            tail = " | ".join(str(l).strip() for l in list(stderr_tail)[-4:] if str(l).strip())[-600:]
            how = f"was killed by signal {-code}" if code < 0 else f"exited with code {code}"
            raise StageError(
                EXIT_MEANING.get(code, "stage_failed"),
                f"The {module} stage {how} without an error report." + (f" Last output: {tail}" if tail else ""),
                code,
            )
