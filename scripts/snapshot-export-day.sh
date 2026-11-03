#!/usr/bin/env bash
# snapshot-export-day.sh — recover a full daily snapshot set from git history.
#
# The daily snapshots live at stable paths (data/snapshots/current/) that are
# overwritten each run, so the working tree only ever holds the latest day.
# Every prior day is preserved in git history via that day's commit. This
# script checks out the snapshot set as it existed on (or just before) a given
# date and copies it to data/snapshots/exported/<date>/ so you can browse it.
#
#   Usage: scripts/snapshot-export-day.sh 2026-06-05
#
set -euo pipefail

DATE="${1:-}"
if [[ -z "$DATE" ]]; then
  echo "usage: $0 <YYYY-MM-DD>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Last commit that touched the snapshot set on or before end-of-day DATE.
SHA="$(git log -1 --format=%H --before="${DATE} 23:59:59" -- data/snapshots/current || true)"
if [[ -z "$SHA" ]]; then
  echo "No snapshot commit found on or before ${DATE}." >&2
  exit 1
fi

OUT="data/snapshots/exported/${DATE}"
rm -rf "$OUT"
mkdir -p "$OUT"

# Materialise every snapshot file from that commit into the export dir.
git ls-tree -r --name-only "$SHA" -- data/snapshots/current | while read -r path; do
  rel="${path#data/snapshots/current/}"
  mkdir -p "$OUT/$(dirname "$rel")"
  git show "${SHA}:${path}" > "$OUT/$rel"
done

COMMIT_DATE="$(git show -s --format=%ci "$SHA")"
echo "Exported snapshot from commit ${SHA:0:10} (${COMMIT_DATE})"
echo "  → ${OUT}/index.html"
