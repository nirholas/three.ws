#!/usr/bin/env bash
# Boot the signal-bridge image with an empty state directory (no Signal number
# registered) and prove the HTTP surface the gateway and Cloud Run depend on:
#
#   GET /v1/health    204  (the Cloud Run startup probe in cloudbuild.yaml)
#   GET /v1/about     mode json-rpc (one resident signal-cli, receive websocket)
#   GET /v1/accounts  []   (unregistered: nothing restored, nothing invented)
#
# Probes run with curl inside the container, so the script behaves the same on
# a laptop and inside a Cloud Build step (where published ports are not
# reachable from the step). Usage: smoke.sh [image]  (default signal-bridge:verify)
set -euo pipefail

image="${1:-signal-bridge:verify}"
name="signal-bridge-smoke-$$"
deadline=$((SECONDS + ${SMOKE_TIMEOUT_SECONDS:-180}))

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container log (last 60 lines) ---"
    docker logs "$name" 2>&1 | tail -60 || true
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# --tmpfs gives /state the same starting point as a brand new state bucket.
docker run -d --name "$name" --tmpfs /state "$image" >/dev/null
echo "started $name from $image"

probe() { docker exec "$name" curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080$1" 2>/dev/null || true; }

code=""
until [ "$code" = "204" ]; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
    echo "FAIL: container exited before /v1/health answered"
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "FAIL: /v1/health never returned 204 (last code: ${code:-none})"
    exit 1
  fi
  sleep 2
  code="$(probe /v1/health)"
done
echo "ok   /v1/health 204"

about="$(docker exec "$name" curl -sf http://localhost:8080/v1/about)"
case "$about" in
  *'"mode":"json-rpc"'*) echo "ok   /v1/about mode json-rpc" ;;
  *) echo "FAIL: /v1/about did not report json-rpc mode: $about"; exit 1 ;;
esac

accounts="$(docker exec "$name" curl -sf http://localhost:8080/v1/accounts)"
if [ "$(echo "$accounts" | tr -d '[:space:]')" != "[]" ]; then
  echo "FAIL: expected no registered accounts, got: $accounts"
  exit 1
fi
echo "ok   /v1/accounts [] (no number registered)"

if ! docker logs "$name" 2>&1 | grep -q 'starting unregistered'; then
  echo "FAIL: persist.sh did not log the unregistered first boot"
  exit 1
fi
echo "ok   persist.sh booted unregistered from an empty state dir"
echo "signal-bridge smoke passed"
