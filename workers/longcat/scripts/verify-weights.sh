#!/usr/bin/env bash
# Compare a staged LongCat weight tree against the committed checksum manifest.
#
#   workers/longcat/scripts/verify-weights.sh                 # check gs://three-ws-model-weights/longcat
#   workers/longcat/scripts/verify-weights.sh /mnt/weights/longcat   # check a local tree
#
# For the bucket this compares object sizes and the stored manifest object with
# workers/longcat/weights.sha256 (cheap, no 45 GB download). For a local tree it
# runs `sha256sum --check`, which hashes every file.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${HERE}/weights.sha256"
[[ -f "${MANIFEST}" ]] || { echo "missing ${MANIFEST}" >&2; exit 1; }

if [[ $# -ge 1 ]]; then
	(cd "$1" && sha256sum --check --quiet "${MANIFEST}")
	echo "local tree matches weights.sha256"
	exit 0
fi

REMOTE="${WEIGHTS_URI:-gs://three-ws-model-weights/longcat}"
if ! diff -q "${MANIFEST}" <(gcloud storage cat "${REMOTE}/weights.sha256") >/dev/null; then
	echo "the manifest in ${REMOTE} differs from workers/longcat/weights.sha256" >&2
	exit 1
fi
missing=0
while read -r _ path; do
	path="${path#\*}"
	if ! gcloud storage ls "${REMOTE}/${path}" >/dev/null 2>&1; then
		echo "missing in bucket: ${path}" >&2
		missing=1
	fi
done <"${MANIFEST}"
[[ "${missing}" -eq 0 ]] && echo "bucket holds every file in weights.sha256"
exit "${missing}"
