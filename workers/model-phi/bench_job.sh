#!/usr/bin/env bash
# Cloud Run GPU job entrypoint for the verification run (cloudbuild.verify.yaml).
#
# Starts the real server (serve.sh, same flags as the service) in the
# background, records container start -> /health 200 as the in-container cold
# start, runs bench.py against it, and writes the report to the results bucket
# mounted at /results. Exits non-zero if the server never came up or the basic
# chat check failed, so the job execution shows the failure.
set -euo pipefail

RUN_ID="${RUN_ID:?RUN_ID names the results folder}"
TASKS="${TASKS:-/results/verify/phi/tasks.json}"
OUT_DIR="/results/verify/phi/${RUN_ID}"
mkdir -p "$OUT_DIR"

healthy() {
  python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=5).status == 200 else 1)" 2>/dev/null
}

container_start=$(date +%s.%N)
/app/serve.sh > >(tee "$OUT_DIR/vllm.log") 2>&1 &
server=$!

for _ in $(seq 1 1200); do
  if healthy; then break; fi
  if ! kill -0 "$server" 2>/dev/null; then echo "vLLM exited before /health answered"; exit 1; fi
  sleep 1
done
health_ok=$(date +%s.%N)
healthy || { echo "vLLM did not answer /health within 20 minutes"; exit 1; }
printf '{"container_start": %s, "health_ok": %s}\n' "$container_start" "$health_ok" > "$OUT_DIR/boot.json"
nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv > "$OUT_DIR/gpu.csv" || true

status=0
python3 /app/bench.py --tasks "$TASKS" --boot "$OUT_DIR/boot.json" --out "$OUT_DIR/report.json" || status=$?
kill "$server" 2>/dev/null || true
wait "$server" 2>/dev/null || true
exit "$status"
