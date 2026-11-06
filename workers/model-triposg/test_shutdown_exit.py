"""A clean SIGTERM scale-in must not end in a native-destructor segfault.

Production 2026-11-05: every "Container terminated on signal 11" on
model-triposg came right after uvicorn logged "Application shutdown complete"
and glibc printed "malloc_consolidate(): unaligned fastbin chunk detected".
The service had already stopped; the crash was interpreter teardown running
CUDA/diso/trimesh native destructors over a corrupted heap, which Cloud Run
reports as a crash. The lifespan now hard-exits with status 0 once shutdown is
complete, so teardown never runs.

    python3 workers/model-triposg/test_shutdown_exit.py
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import test_prepare_photo as tp  # noqa: E402, installs the stubs and imports main

main = tp.main


def test_lifespan_exit_hard_exits_zero_after_shutdown():
    exits = []
    original_exit = main.os._exit
    original_loader = main._load_models_bg

    async def _no_load():
        return None

    main._load_models_bg = _no_load
    main.os._exit = lambda code: exits.append(code)
    try:
        async def _run():
            async with main.lifespan(main.app):
                assert exits == [], "must not exit while serving"

        asyncio.run(_run())
    finally:
        main.os._exit = original_exit
        main._load_models_bg = original_loader
    assert exits == [0], f"lifespan teardown must os._exit(0), got {exits}"


if __name__ == "__main__":
    test_lifespan_exit_hard_exits_zero_after_shutdown()
    print("ok")
