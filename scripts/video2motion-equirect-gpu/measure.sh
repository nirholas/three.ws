#!/usr/bin/env bash
# Measure the model-video2motion equirect pipeline on a Cloud Run L4 through a throwaway Job.
#
#   scripts/video2motion-equirect-gpu/measure.sh build     # build + push the throwaway image
#   scripts/video2motion-equirect-gpu/measure.sh run       # create the job, execute, wait, print the table
#   scripts/video2motion-equirect-gpu/measure.sh cleanup   # delete job, image and repository
#
# Env overrides: REGION (europe-west4), MATRIX (clip names under
# insta360/derived/c3-equirect-clips/), SECONDS_PER_CLIP (12).
set -euo pipefail

PROJECT=aerial-vehicle-466722-p5
REGION="${REGION:-europe-west4}"
REPO=v2m-equirect-proof
JOB=v2m-equirect-proof
TAG="${TAG:-proof-$(date -u +%Y%m%d)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/server:${TAG}"
MATRIX="${MATRIX:-w3zKUGqDnik LMLCuk5v_Dw nW-QMhkt6_8}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export TMPDIR="${TMPDIR:-/home/user/.cache/gcloud-tmp}"
mkdir -p "$TMPDIR"

build() {
  gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" > /dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" \
      --project "$PROJECT" --description "Throwaway video2motion equirect proof image (delete after use)"
  ctx="$(mktemp -d)"
  mkdir -p "$ctx/worker" "$ctx/proof"
  (cd "$ROOT/workers/model-video2motion" && cp Dockerfile requirements.txt worker_security.py canonical_rest.py \
    pose_solver.py equirect.py main.py "$ctx/worker/")
  cp "$ROOT/workers/model-video2motion/local_equirect.py" "$HERE/Dockerfile" "$HERE/run.py" "$ctx/proof/"
  cp "$HERE/cloudbuild.yaml" "$ctx/"
  gcloud builds submit "$ctx" --config "$ctx/cloudbuild.yaml" --substitutions "_IMAGE=$IMAGE" \
    --project "$PROJECT" --region us-central1
  rm -rf "$ctx"
}

run() {
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  count=$(wc -w <<< "$MATRIX")
  gcloud beta run jobs deploy "$JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
    --service-account "three-ws@${PROJECT}.iam.gserviceaccount.com" \
    --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 8 --memory 32Gi \
    --tasks "$count" --parallelism "$count" --max-retries 0 --task-timeout 1h \
    --add-volume name=fixtures,type=cloud-storage,bucket=three-ws-capture-fixtures,readonly=true \
    --add-volume-mount volume=fixtures,mount-path=/fixtures \
    --add-volume name=results,type=cloud-storage,bucket=three-ws-pano-captures \
    --add-volume-mount volume=results,mount-path=/results \
    --set-env-vars "^|^MATRIX=${MATRIX}|RUN_ID=${run_id}|SECONDS=${SECONDS_PER_CLIP:-12}" \
    --labels program=gcp-credits,lane=v2m-equirect-proof
  echo "RUN_ID=$run_id"
  gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait || true
  gsutil cat "gs://three-ws-pano-captures/video2motion-equirect/${run_id}/*/exit.json" 2>/dev/null || true
}

cleanup() {
  gcloud run jobs delete "$JOB" --project "$PROJECT" --region "$REGION" --quiet 2>/dev/null || true
  gcloud artifacts repositories delete "$REPO" --location "$REGION" --project "$PROJECT" --quiet 2>/dev/null || true
}

"${1:?usage: measure.sh build|run|cleanup}" "${@:2}"
