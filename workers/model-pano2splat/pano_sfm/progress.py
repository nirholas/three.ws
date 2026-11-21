"""JSON-lines progress on stdout, exactly the C1 shape."""

import json
import sys
import threading

_lock = threading.Lock()


def emit(stage: str, progress: float) -> None:
    line = json.dumps({"stage": stage, "progress": round(max(0.0, min(1.0, progress)), 4)})
    with _lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
