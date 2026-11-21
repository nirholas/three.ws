"""Cloud Run Job entrypoint: one 360 clip per task through the equirect pipeline.

Task N (CLOUD_RUN_TASK_INDEX) handles the Nth name in MATRIX. Inputs are read
from the read-only fixtures mount, outputs go to the results mount.
"""
import json
import os
import shutil
import subprocess
import sys
import time

os.environ.setdefault("API_KEY", "job")
os.environ.setdefault("GCS_BUCKET", "job")

import local_equirect  # noqa: E402

names = os.environ["MATRIX"].split()
name = names[int(os.environ.get("CLOUD_RUN_TASK_INDEX", "0"))]
run_id = os.environ["RUN_ID"]
seconds = float(os.environ.get("SECONDS", "12"))
src = f"/fixtures/insta360/derived/c3-equirect-clips/{name}.mp4"
out = f"/results/video2motion-equirect/{run_id}/{name}"
work = f"/tmp/{name}"
os.makedirs(out, exist_ok=True)

gpu = subprocess.run(
    ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
    capture_output=True, text=True,
)
with open(f"{out}/gpu.txt", "w") as f:
    f.write(gpu.stdout or gpu.stderr or "no nvidia-smi\n")

started = time.time()
status = {"clip": name, "exit": 0}
try:
    _, stats = local_equirect.run(src, work, 24, seconds, None)
    status["stats"] = stats
except Exception as exc:  # noqa: BLE001
    status["exit"] = 1
    status["error"] = repr(exc)
status["wall_seconds"] = round(time.time() - started, 2)
for fn in ("reframe.mp4", "subject_track.json", "stats.json", "clip.json"):
    p = f"{work}/{fn}"
    if os.path.exists(p):
        shutil.copy(p, f"{out}/{fn}")
with open(f"{out}/exit.json", "w") as f:
    json.dump(status, f, indent=1)
print(json.dumps(status))
sys.exit(status["exit"])
