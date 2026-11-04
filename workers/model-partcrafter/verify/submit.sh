#!/usr/bin/env bash
# Run one real image through model-partcrafter end to end on Cloud Build
# (CPU, default steps and decode depth; about two hours) and print where the
# GLB lands. Verify-only: no image push, no deploy.
#
# Usage: workers/model-partcrafter/verify/submit.sh [image] [num_parts]
#   image defaults to the CC0 chair in data/quality-bench/refs/.
# Then check:  gcloud builds describe <id> --format='value(status)'
# and:         node scripts/verify-restyle-parts.mjs <downloaded parts.glb>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
image="${1:-$repo/data/quality-bench/refs/chair.jpg}"
parts="${2:-4}"
out="gs://three-ws-avatar-reconstructions/verify/partcrafter-$(date -u +%Y%m%d-%H%M%S)"

ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
mkdir "$ctx/worker"
(cd "$repo/workers/model-partcrafter" && tar --exclude=__pycache__ --exclude=verify -cf - .) | tar -xf - -C "$ctx/worker"
cp "$here/run.py" "$here/cloudbuild.yaml" "$ctx/"
cp "$image" "$ctx/$(basename "$image")"

gcloud builds submit --async --config "$ctx/cloudbuild.yaml" \
  --substitutions="_IMAGE=$(basename "$image"),_PARTS=$parts,_OUT=$out" "$ctx"
echo "outputs: $out/parts.glb $out/manifest.json $out/run.log"
