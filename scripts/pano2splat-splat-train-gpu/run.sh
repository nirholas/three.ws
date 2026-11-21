#!/usr/bin/env bash
# Cloud Run Job entrypoint: one task = one (dataset, iterations) cell of the measurement matrix.
#   MATRIX       space-separated "dataset:iterations" cells, indexed by CLOUD_RUN_TASK_INDEX
#   FIXTURES     mount of gs://three-ws-capture-fixtures (read only)
#   RESULTS      mount of gs://three-ws-pano-captures
#   RUN_ID       folder name under $RESULTS/splat_train-measure/
#   EXTRA_ARGS   extra splat_train flags (optional)
# measure.sh uploads the current splat_train package next to the results, so code changes are
# measured without rebuilding the dependency image.
set -uo pipefail

idx="${CLOUD_RUN_TASK_INDEX:-0}"
read -r -a cells <<< "${MATRIX:?MATRIX is required}"
cell="${cells[$idx]:?no matrix cell for task $idx}"
dataset="${cell%%:*}"
iterations="${cell##*:}"
name="$(basename "$dataset")-${iterations}"
src="${FIXTURES:-/fixtures}/${dataset}"
work="/tmp/work/${name}"
dest="${RESULTS:-/results}/splat_train-measure/${RUN_ID:?RUN_ID is required}/${name}"
mkdir -p "$work/colmap" "$work/out"

code_dir="${RESULTS:-/results}/splat_train-measure/${RUN_ID}/code/splat_train"
if [ -d "$code_dir" ]; then
  rm -rf /app/splat_train && cp -r "$code_dir" /app/splat_train
fi
(cd /app && sha256sum splat_train/*.py) > "$work/out/code.sha256"

nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | tee "$work/out/gpu.txt"

# Copy the dataset off the FUSE mount first so image decoding is not bound by object reads.
t0=$(date +%s)
cp -r "$src/sparse" "$src/images" "$work/colmap/"
[ -d "$src/masks" ] && cp -r "$src/masks" "$work/colmap/"
t1=$(date +%s)
echo "{\"stage\":\"fetch\",\"seconds\":$((t1 - t0))}"

# shellcheck disable=SC2086
python -m splat_train --colmap "$work/colmap" --out "$work/out" --iterations "$iterations" \
    --preview-video ${EXTRA_ARGS:-} > >(tee "$work/out/stdout.jsonl") 2> >(tee "$work/out/stderr.log" >&2)
code=$?
wait
t2=$(date +%s)
echo "{\"task\":\"$name\",\"exit\":$code,\"wall_s\":$((t2 - t1))}" | tee "$work/out/exit.json"

mkdir -p "$dest"
cp -r "$work/out/." "$dest/"
echo "copied results to $dest"
exit "$code"
