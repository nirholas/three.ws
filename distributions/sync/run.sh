#!/usr/bin/env bash
# One scheduled pass over every externally hosted three.ws distribution:
#   1. nirholas/three-ws-agent  merged with Hermes Agent upstream, overlay refreshed, verified
#   2. nirholas/three-ws-gemini mirrored from distributions/gemini-cli and tagged
#
# Cloud Build runs this daily (distributions/sync/cloudbuild.json, scheduled by
# scripts/create-distribution-sync-job.mjs). Locally it is a dry run unless PUSH=1.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export THREE_WS_DIR="${THREE_WS_DIR:-$(cd "$HERE/../.." && pwd)}"
WORK_ROOT="${WORK_ROOT:-$(mktemp -d)}"

WORK_DIR="$WORK_ROOT/hermes" bash "$HERE/sync-hermes.sh"
WORK_DIR="$WORK_ROOT/gemini" bash "$HERE/publish-extension.sh" \
	"$THREE_WS_DIR/distributions/gemini-cli" \
	"${GEMINI_REPO_URL:-https://github.com/nirholas/three-ws-gemini.git}" \
	gemini-extension.json
