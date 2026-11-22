#!/usr/bin/env bash
# Measure workers/model-pano2splat/splat_train on a Cloud Run L4 through a throwaway Job.
#
#   scripts/pano2splat-splat-train-gpu/measure.sh build        # build + push the image
#   scripts/pano2splat-splat-train-gpu/measure.sh run          # create the job, execute, wait
#   scripts/pano2splat-splat-train-gpu/measure.sh report RUN_ID   # table from the train.json files
#   scripts/pano2splat-splat-train-gpu/measure.sh cleanup      # delete job, image and repository
#
# Env overrides: REGION (europe-west4), MATRIX, PARALLELISM (4), EXTRA_ARGS.
set -euo pipefail

PROJECT=aerial-vehicle-466722-p5
REGION="${REGION:-europe-west4}"
REPO=splat-train-measure
JOB=splat-train-measure
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/splat-train:latest"
MATRIX="${MATRIX:-splat_train/mipnerf360/garden:7000 splat_train/mipnerf360/counter:7000 splat_train/mipnerf360/garden:30000 splat_train/mipnerf360/counter:30000}"
PARALLELISM="${PARALLELISM:-4}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export TMPDIR="${TMPDIR:-/home/user/.cache/gcloud-tmp}"
mkdir -p "$TMPDIR"

build() {
  gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" > /dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" \
      --project "$PROJECT" --description "Throwaway splat_train measurement image (delete after use)"
  ctx="$(mktemp -d)"
  cp "$HERE/Dockerfile" "$HERE/run.sh" "$ctx/"
  mkdir -p "$ctx/requirements.d"
  cp "$ROOT/workers/model-pano2splat/requirements.d/splat_train.txt" "$ctx/requirements.d/"
  cp -r "$ROOT/workers/model-pano2splat/splat_train" "$ctx/"
  find "$ctx" -name __pycache__ -prune -exec rm -rf {} +
  gcloud builds submit "$ctx" --config "$HERE/cloudbuild.yaml" --substitutions "_IMAGE=$IMAGE" \
    --project "$PROJECT" --region us-central1
  rm -rf "$ctx"
}

run() {
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  count=$(wc -w <<< "$MATRIX")
  # GPU tasks longer than 1 h need the BETA launch stage.
  gcloud beta run jobs deploy "$JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
    --service-account "three-ws@${PROJECT}.iam.gserviceaccount.com" \
    --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 8 --memory 32Gi \
    --tasks "$count" --parallelism "$PARALLELISM" --max-retries 0 --task-timeout 4h \
    --add-volume name=fixtures,type=cloud-storage,bucket=three-ws-capture-fixtures,readonly=true \
    --add-volume-mount volume=fixtures,mount-path=/fixtures \
    --add-volume name=results,type=cloud-storage,bucket=three-ws-pano-captures \
    --add-volume-mount volume=results,mount-path=/results \
    --set-env-vars "^|^MATRIX=${MATRIX}|RUN_ID=${run_id}|EXTRA_ARGS=${EXTRA_ARGS:-}" \
    --labels program=gcp-credits,lane=splat-train-measure
  gsutil -m -q rsync -r -x '.*__pycache__.*' "$ROOT/workers/model-pano2splat/splat_train" \
    "gs://three-ws-pano-captures/splat_train-measure/${run_id}/code/splat_train"
  echo "RUN_ID=$run_id"
  gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait || true
  report "$run_id"
}

report() {
  run_id="${1:?RUN_ID}"
  url="gs://three-ws-pano-captures/splat_train-measure/${run_id}"
  dir="$(mktemp -d)"
  for f in $(gsutil ls "$url/*/exit.json" "$url/*/train.json" 2>/dev/null); do
    cell="$(basename "$(dirname "$f")")"
    mkdir -p "$dir/$cell"
    gsutil -q cp "$f" "$dir/$cell/"
  done
  gsutil du "$url/*/preview.mp4" 2>/dev/null > "$dir/mp4-sizes.txt" || true
  python3 - "$dir" "$run_id" <<'PY'
import json, os, re, sys
root, run_id = sys.argv[1], sys.argv[2]
sizes = {}
for line in open(os.path.join(root, 'mp4-sizes.txt')):
    size, url = line.split()
    sizes[url.rstrip('/').split('/')[-2]] = int(size)
def load(cell, name):
    path = os.path.join(root, cell, name)
    return json.load(open(path)) if os.path.exists(path) else {}
mb = lambda b: f'{b / 1e6:.1f} MB' if b else '-'
print(f'run {run_id}  gs://three-ws-pano-captures/splat_train-measure/{run_id}/')
print('| scene | iterations | PSNR | SSIM | Gaussians | scene.ply | scene.spz | preview.mp4 | train s | splat_train s | task wall s (L4 GPU-s) | peak GPU GB | exit |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
cells = [c for c in os.listdir(root) if re.fullmatch(r'.+-\d+', c) and os.path.isdir(os.path.join(root, c))]
for cell in sorted(cells, key=lambda c: (int(c.rsplit('-', 1)[1]), c)):
    scene, iters = cell.rsplit('-', 1)
    ex, tj = load(cell, 'exit.json'), load(cell, 'train.json')
    g = tj.get('gaussians')
    print(f"| {scene} | {iters} | {tj.get('psnr_holdout', '-')} | {tj.get('ssim_holdout', '-')} | {f'{g:,}' if g else '-'} | "
          f"{mb(tj.get('bytes_ply'))} | {mb(tj.get('bytes_spz'))} | {mb(sizes.get(cell))} | "
          f"{tj.get('train_seconds', '-')} | {tj.get('duration_s', '-')} | {ex.get('wall_s', '-')} | {tj.get('peak_gpu_gb', '-')} | {ex.get('exit', '-')} |")
PY
  rm -rf "$dir"
}

cleanup() {
  gcloud run jobs delete "$JOB" --project "$PROJECT" --region "$REGION" --quiet 2>/dev/null || true
  gcloud artifacts repositories delete "$REPO" --location "$REGION" --project "$PROJECT" --quiet 2>/dev/null || true
}

"${1:?usage: measure.sh build|run|report RUN_ID|cleanup}" "${@:2}"
