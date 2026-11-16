#!/usr/bin/env bash
# Cloud Storage legs of the daily database backup (deploy/db-backup/README.md).
# Runs in the Google Cloud SDK image as three-ws-build@.
#   transfer.sh upload    push /workspace/out/neondb.tar, time it, drop the local copy
#   transfer.sh download  pull the same object back (the restore test reads only this copy)
#   transfer.sh publish   store report.json beside the archive and as latest.json,
#                         then fail the build when the restore test did not pass
set -euo pipefail

BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
OUT=/workspace/out

case "${1:-}" in
upload)
	object="gs://$BUCKET/neondb/$(date -u +%Y-%m-%d)/$(date -u +%H%M%SZ)/neondb.tar"
	t0=$(date +%s)
	gcloud storage cp --quiet "$OUT/neondb.tar" "$object"
	t1=$(date +%s)
	echo "$object" > "$OUT/object"
	echo $((t1 - t0)) > "$OUT/upload_seconds"
	rm -f "$OUT/neondb.tar"
	echo "uploaded $object in $((t1 - t0))s"
	;;
download)
	object=$(cat "$OUT/object")
	mkdir -p "$OUT/restore"
	t0=$(date +%s)
	gcloud storage cp --quiet "$object" "$OUT/restore/neondb.tar"
	t1=$(date +%s)
	echo $((t1 - t0)) > "$OUT/download_seconds"
	echo "downloaded $object in $((t1 - t0))s"
	;;
publish)
	object=$(cat "$OUT/object")
	gcloud storage cp --quiet "$OUT/report.json" "${object%/neondb.tar}/report.json"
	gcloud storage cp --quiet "$OUT/report.json" "gs://$BUCKET/neondb/latest.json"
	if ! grep -q '"ok":true' "$OUT/report.json"; then
		echo "backup restore test FAILED, see ${object%/neondb.tar}/report.json"
		exit 1
	fi
	echo "backup verified: ${object%/neondb.tar}/report.json"
	;;
*)
	echo "usage: transfer.sh upload|download|publish" >&2
	exit 2
	;;
esac
