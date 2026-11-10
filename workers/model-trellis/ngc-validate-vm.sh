#!/usr/bin/env bash
# GPU validation of the NGC candidate image. Runs as a GCE startup script on a
# short-lived GPU VM (see scripts/ngc-validate-trellis.sh, which creates and
# deletes the VM). Standalone mode only: mounted weights, OUTPUT_DIR, no GCS
# backend. Evidence is written to gs://$EVIDENCE_PREFIX and the VM powers off.
set -uo pipefail

md() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
IMAGE="$(md image)"
EVIDENCE="$(md evidence)"
TIER="$(md tier || echo standard)"
LOG=/var/log/ngc-validate.log
exec > >(tee -a "$LOG") 2>&1

finish() {
	gsutil cp "$LOG" "$EVIDENCE/run.log" || true
	shutdown -h now
}
trap finish EXIT

stamp() { date +%s.%N; }
echo "== host =="; nvidia-smi --query-gpu=name,driver_version,compute_cap,memory.total --format=csv
GPU_JSON="$(nvidia-smi --query-gpu=name,driver_version,compute_cap,memory.total --format=csv,noheader | head -1)"

command -v docker >/dev/null || { echo "docker missing"; exit 1; }
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
mkdir -p /weights /output
T0=$(stamp)
gsutil -m cp -r gs://three-ws-model-weights/trellis-large /weights/ || { echo "weights copy failed"; exit 1; }
rm -rf /weights/trellis-large/.cache
T_WEIGHTS=$(stamp)
docker pull "$IMAGE" || { echo "pull failed"; exit 1; }
T_PULL=$(stamp)
IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}} {{.Size}}')"

KEY="ngc-validate-$RANDOM$RANDOM"
docker run -d --name trellis --gpus all -p 8080:8080 \
	-e API_KEY="$KEY" -e WEIGHTS_DIR=/weights/trellis-large \
	-v /weights/trellis-large:/weights/trellis-large:ro -v /output:/output "$IMAGE" || { echo "run failed"; exit 1; }

READY=0
# /health answers 503 once the load budget is spent, so read the body whatever
# the status code and stop early on a load error instead of waiting out the loop.
health_field() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read() or "{}"); v=d.get(sys.argv[1]); print("" if v in (None, False) else v)' "$1" 2>/dev/null; }
for i in $(seq 1 240); do
	H="$(curl -sS localhost:8080/health 2>/dev/null || true)"
	if [ "$(echo "$H" | health_field ready)" = True ]; then READY=1; break; fi
	if [ -n "$(echo "$H" | health_field load_error)" ]; then break; fi
	sleep 5
done
T_READY=$(stamp)
echo "health: $H"
if [ "$READY" != 1 ]; then docker logs trellis 2>&1 | tail -60; echo "pipeline never became ready"; exit 1; fi

docker cp trellis:/app/TRELLIS/assets/example_image/. /tmp/examples
IMG="$(ls /tmp/examples/*.png | head -1)"
echo "input image: $IMG"
B64="$(base64 -w0 "$IMG")"
printf '{"images":["data:image/png;base64,%s"],"tier":"%s"}' "$B64" "$TIER" > /tmp/req.json
RESP="$(curl -fsS -X POST localhost:8080/infer -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data-binary @/tmp/req.json)"
echo "infer: $RESP"
TASK="$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("task_id") or d.get("id"))')"
T_SUBMIT=$(stamp)
STATUS=""
for i in $(seq 1 360); do
	S="$(curl -fsS "localhost:8080/tasks/$TASK" -H "Authorization: Bearer $KEY" 2>/dev/null || true)"
	STATUS="$(echo "$S" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
	[ "$STATUS" = completed ] || [ "$STATUS" = done ] || [ "$STATUS" = failed ] && break
	sleep 5
done
T_DONE=$(stamp)
echo "task: $S"
curl -fsS -o /tmp/out.glb "localhost:8080/results/$TASK.glb" -H "Authorization: Bearer $KEY" || echo "download failed"
ls -l /tmp/out.glb
docker cp /tmp/out.glb trellis:/tmp/out.glb
GLB_STATS="$(docker exec trellis python3 - <<'PY'
import json, trimesh
scene = trimesh.load('/tmp/out.glb')
geoms = list(scene.geometry.values()) if hasattr(scene, 'geometry') else [scene]
faces = sum(len(g.faces) for g in geoms)
verts = sum(len(g.vertices) for g in geoms)
textured = any(getattr(getattr(g, 'visual', None), 'material', None) is not None for g in geoms)
print(json.dumps({'geometries': len(geoms), 'faces': faces, 'vertices': verts, 'has_material': textured}))
PY
)"
echo "glb: $GLB_STATS"
docker logs trellis 2>&1 | tail -40 > /tmp/container-tail.log

python3 - <<PY > /tmp/evidence.json
import json
t = lambda a, b: round(float(b) - float(a), 1)
print(json.dumps({
  'gpu': """$GPU_JSON""",
  'image': """$IMAGE""",
  'image_id_and_size': """$IMAGE_ID""",
  'tier': """$TIER""",
  'status': """$STATUS""",
  'seconds': {'weights_copy': t($T0, $T_WEIGHTS), 'pull': t($T_WEIGHTS, $T_PULL), 'pipeline_ready': t($T_PULL, $T_READY), 'infer': t($T_SUBMIT, $T_DONE)},
  'glb': json.loads("""$GLB_STATS"""),
}, indent=2))
PY
cat /tmp/evidence.json
gsutil cp /tmp/evidence.json "$EVIDENCE/evidence.json"
gsutil cp /tmp/out.glb "$EVIDENCE/result.glb"
gsutil cp /tmp/container-tail.log "$EVIDENCE/container-tail.log"
