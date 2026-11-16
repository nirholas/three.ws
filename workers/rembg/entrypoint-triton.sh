#!/usr/bin/env bash
# Triton GPU lane: tritonserver (gRPC 8001, metrics 8002, both loopback-only by
# Cloud Run's single ingress port) plus the HTTP adapter on 8080. uvicorn only
# binds 8080 after its startup hook has seen every model ready, so Cloud Run's
# startup probe holds traffic until the GPU is warm. If either process exits,
# the container exits and Cloud Run replaces the instance.
set -euo pipefail

tritonserver \
  --model-repository="${TRITON_MODEL_REPOSITORY:-/models}" \
  --http-port=8000 --grpc-port=8001 --metrics-port=8002 \
  --strict-readiness=true --exit-on-error=true \
  --log-verbose=0 &
triton_pid=$!

uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}" --workers 1 &
app_pid=$!

trap 'kill -TERM "$triton_pid" "$app_pid" 2>/dev/null || true' TERM INT
set +e
wait -n "$triton_pid" "$app_pid"
status=$?
kill -TERM "$triton_pid" "$app_pid" 2>/dev/null
wait
exit "$status"
