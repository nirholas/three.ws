"""
CAD Forge worker: builds a build123d program into a real B-rep part.

API contract:
  POST /build   { code: str }
             →  200 { ok: true,  metrics, artifacts: { step, stl, glb, thumb_svg?, drawing_svg? }, log, elapsed_s }
             →  200 { ok: false, error: { kind, message, line }, log, elapsed_s }
       Artifacts are base64. A program that fails is still a 200: the failure is
       the program's, and the caller (api/cad.js) feeds it back to the model for
       a repair round. Non-200 means the worker itself could not run the build.

  GET  /health  → { ok, warm, max_concurrent, seccomp_required, build123d }

Every build runs in its own sandbox_child.py process: parked warm (build123d
already imported), unprivileged uid, scrubbed env, resource limits, seccomp,
then exits. The worker holds no cloud credentials: artifacts return inline and
the API uploads them.

Environment variables:
  API_KEY            shared bearer secret (required)
  MAX_CONCURRENT     builds allowed at once (default: 2)
  WARM_POOL          parked children kept ready (default: MAX_CONCURRENT)
  BUILD_TIMEOUT_S    wall-clock limit per build (default: 60)
  REQUIRE_SECCOMP    refuse to build when seccomp cannot load (default: 1)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import resource
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from importlib import metadata
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from cad_policy import MAX_SOURCE_CHARS
from worker_security import require_api_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cad-forge")

API_KEY = os.environ.get("API_KEY", "")
MAX_CONCURRENT = max(1, int(os.environ.get("MAX_CONCURRENT", "2")))
WARM_POOL = max(1, int(os.environ.get("WARM_POOL", str(MAX_CONCURRENT))))
BUILD_TIMEOUT_S = float(os.environ.get("BUILD_TIMEOUT_S", "60"))
REQUIRE_SECCOMP = os.environ.get("REQUIRE_SECCOMP", "1") != "0"

CHILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sandbox_child.py")
SANDBOX_UID = 65534  # nobody
MEMORY_LIMIT_BYTES = int(os.environ.get("SANDBOX_MEMORY_MB", "3072")) * 1024 * 1024
CPU_LIMIT_S = int(BUILD_TIMEOUT_S * 2)
MAX_ARTIFACT_BYTES = 24 * 1024 * 1024
ARTIFACT_KEYS = {
    "part.step": "step",
    "part.stl": "stl",
    "part.glb": "glb",
    "thumb.svg": "thumb_svg",
    "drawing.svg": "drawing_svg",
}


def _limits() -> None:
    """preexec_fn: hard ceilings the program cannot raise."""
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_LIMIT_S, CPU_LIMIT_S))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    os.setsid()


@dataclass
class Child:
    proc: subprocess.Popen
    workdir: str
    started: float


def _spawn() -> Child:
    workdir = tempfile.mkdtemp(prefix="cad-")
    drop = os.geteuid() == 0
    if drop:
        os.chown(workdir, SANDBOX_UID, SANDBOX_UID)
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": workdir,
        "TMPDIR": workdir,
        # OpenBLAS (pulled in through scipy) otherwise starts one thread per
        # host core, and 32 thread stacks blow straight through RLIMIT_AS.
        "OMP_NUM_THREADS": "2",
        "OPENBLAS_NUM_THREADS": "2",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    proc = subprocess.Popen(
        [sys.executable, "-I", CHILD],
        cwd=workdir,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        close_fds=True,
        preexec_fn=_limits,
        user=SANDBOX_UID if drop else None,
        group=SANDBOX_UID if drop else None,
        extra_groups=[] if drop else None,
    )
    return Child(proc=proc, workdir=workdir, started=time.monotonic())


def _discard(child: Child) -> None:
    if child.proc.poll() is None:
        child.proc.kill()
    try:
        child.proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        log.error("sandbox child %s did not exit after kill", child.proc.pid)
    for stream in (child.proc.stdin, child.proc.stdout, child.proc.stderr):
        if stream and not stream.closed:
            stream.close()
    shutil.rmtree(child.workdir, ignore_errors=True)


class WarmPool:
    """Children that have finished importing build123d and wait for one job."""

    def __init__(self, size: int):
        self.size = size
        self._ready: list[Child] = []
        self._lock = threading.Lock()

    def _await_ready(self, child: Child) -> bool:
        line = child.proc.stdout.readline()
        if line.strip() == b"READY":
            return True
        err = child.proc.stderr.read().decode("utf-8", "replace")[-2000:] if child.proc.poll() is not None else ""
        log.error("sandbox child failed to start: %s", err or line[:200])
        _discard(child)
        return False

    def refill(self) -> None:
        while True:
            with self._lock:
                if len(self._ready) >= self.size:
                    return
            child = _spawn()
            if not self._await_ready(child):
                return
            with self._lock:
                self._ready.append(child)

    def take(self) -> Child:
        with self._lock:
            child = self._ready.pop(0) if self._ready else None
        if child is None or child.proc.poll() is not None:
            if child is not None:
                _discard(child)
            child = _spawn()
            if not self._await_ready(child):
                raise RuntimeError("sandbox child failed to start")
        threading.Thread(target=self.refill, daemon=True).start()
        return child

    def warm(self) -> int:
        with self._lock:
            return sum(1 for c in self._ready if c.proc.poll() is None)

    def close(self) -> None:
        with self._lock:
            children, self._ready = self._ready, []
        for child in children:
            _discard(child)


pool = WarmPool(WARM_POOL)
_slots = asyncio.Semaphore(MAX_CONCURRENT)


CRASH_LINE = re.compile(r'File "<design>", line (\d+)')


def _signal_failure(returncode: int, stderr: str) -> dict:
    """Explain a child that died before reporting, by the signal that killed it."""
    signum = -returncode if returncode and returncode < 0 else None
    match = CRASH_LINE.findall(stderr or "")
    # faulthandler prints the most recent call first: the first match is the
    # innermost program line.
    line = int(match[0]) if match else None
    if signum == signal.SIGXCPU:
        return {"kind": "timeout", "message": "The design used more CPU time than a build allows. Reduce feature counts or boolean operations.", "line": line}
    if signum in (signal.SIGKILL, signal.SIGABRT):
        return {"kind": "memory", "message": "The build process was stopped by its memory limit. Simplify the geometry.", "line": line}
    where = f" while running line {line}" if line else ""
    return {"kind": "crash", "message": f"The geometry kernel crashed{where}. That operation received geometry it cannot handle; build that feature a different way.", "line": line}


def _collect(child: Child, result: dict) -> dict:
    if not result.get("ok"):
        return result
    artifacts = {}
    total = 0
    for name in result.get("files", []):
        path = os.path.join(child.workdir, name)
        if name not in ARTIFACT_KEYS or not os.path.isfile(path):
            continue
        total += os.path.getsize(path)
        if total > MAX_ARTIFACT_BYTES:
            return {
                "ok": False,
                "error": {"kind": "export", "message": "The exported files exceed 24 MB. Reduce detail such as fine fillets, text, or thread pitch.", "line": None},
                "log": result.get("log", ""),
                "elapsed_s": result.get("elapsed_s"),
            }
        with open(path, "rb") as fh:
            artifacts[ARTIFACT_KEYS[name]] = base64.b64encode(fh.read()).decode("ascii")
    result["artifacts"] = artifacts
    result.pop("files", None)
    return result


def _read_result(child: Child) -> Optional[dict]:
    path = os.path.join(child.workdir, "result.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def run_build(code: str) -> dict:
    child = pool.take()
    started = time.perf_counter()
    try:
        job = json.dumps({"code": code, "require_seccomp": REQUIRE_SECCOMP}) + "\n"
        try:
            _, stderr = child.proc.communicate(job.encode("utf-8"), timeout=BUILD_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            child.proc.kill()
            # The part is reported before its drawings, so a build that timed
            # out while projecting views still has a complete part to return.
            result = _read_result(child)
            if result and result.get("ok"):
                result["drawings_skipped"] = True
                return _collect(child, result)
            return {
                "ok": False,
                "error": {"kind": "timeout", "message": f"The design took longer than {int(BUILD_TIMEOUT_S)} s to build. Reduce feature counts or boolean operations.", "line": None},
                "log": "",
                "elapsed_s": round(time.perf_counter() - started, 3),
            }
        result = _read_result(child)
        if result is None:
            text = stderr.decode("utf-8", "replace")
            log.warning("sandbox child exited %s without a result: %s", child.proc.returncode, text[-800:])
            return {
                "ok": False,
                "error": _signal_failure(child.proc.returncode, text),
                "log": "",
                "elapsed_s": round(time.perf_counter() - started, 3),
            }
        return _collect(child, result)
    finally:
        _discard(child)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=pool.refill, daemon=True).start()
    yield
    pool.close()


app = FastAPI(title="three.ws CAD Forge", lifespan=lifespan)


class BuildRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)


def _auth(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from None


@app.get("/health")
def health():
    return {
        "ok": True,
        "warm": pool.warm(),
        "max_concurrent": MAX_CONCURRENT,
        "seccomp_required": REQUIRE_SECCOMP,
        "build123d": metadata.version("build123d"),
    }


@app.post("/build")
async def build(req: BuildRequest, authorization: Optional[str] = Header(default=None)):
    _auth(authorization)
    async with _slots:
        try:
            return await asyncio.to_thread(run_build, req.code)
        except RuntimeError as exc:
            log.error("build could not start: %s", exc)
            raise HTTPException(status_code=503, detail="The CAD sandbox is starting. Retry in a few seconds.") from None
