#!/usr/bin/env bash
# Push the validated TRELLIS container to the NGC private STAGING repository.
#
#   scripts/ngc-stage-trellis.sh --org <ngc-org> --version <x.y.z> --digest sha256:<hex>            # prints the plan, pushes nothing
#   NGC_API_KEY=... scripts/ngc-stage-trellis.sh --org <ngc-org> --version <x.y.z> --digest sha256:<hex> --yes-push
#
# This is step 2 of NVIDIA's published process (docs/nvidia-ngc-listing.md,
# "The publishing process"). It publishes nothing to the public catalog; NVIDIA's
# scan, QA and sign-off (steps 3 and 4) decide that. It runs only on an explicit
# owner command: without --yes-push it contacts neither Artifact Registry nor
# NGC and exits 2.
#
# Preconditions the owner completes first (listing doc, Gate 4):
#   1. NGC Partner Legal Agreement signed.
#   2. A private staging repository created at nvcr.io/<org>/trellis-mesh-server.
#   3. An NGC API key exported as NGC_API_KEY (never passed on the command line).
set -euo pipefail

SRC_REPO="us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server"
NAME="trellis-mesh-server"
ORG=""; VERSION=""; DIGEST=""; PUSH=0

while [ $# -gt 0 ]; do
	case "$1" in
		--org) ORG="${2:-}"; shift 2 ;;
		--version) VERSION="${2:-}"; shift 2 ;;
		--digest) DIGEST="${2:-}"; shift 2 ;;
		--yes-push) PUSH=1; shift ;;
		-h|--help) sed -n 2,18p "$0"; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 64 ;;
	esac
done

[ -n "$ORG" ] && [ -n "$VERSION" ] && [ -n "$DIGEST" ] || { echo "usage: $0 --org <ngc-org> --version <x.y.z> --digest sha256:<hex> [--yes-push]" >&2; exit 64; }
[[ "$ORG" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "invalid --org: $ORG" >&2; exit 64; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { echo "invalid --version: $VERSION" >&2; exit 64; }
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "invalid --digest (want sha256:<64 hex>): $DIGEST" >&2; exit 64; }

SRC="${SRC_REPO}@${DIGEST}"
DEST="nvcr.io/${ORG}/${NAME}:${VERSION}"

echo "Plan:"
echo "  source       ${SRC}"
echo "  destination  ${DEST}   (NGC private staging)"

if [ "$PUSH" -ne 1 ]; then
	echo
	echo "Not pushing: --yes-push was not given. Nothing was contacted." >&2
	exit 2
fi

: "${NGC_API_KEY:?export NGC_API_KEY (an NGC API key) before running with --yes-push}"

printf '%s' "$NGC_API_KEY" | docker login nvcr.io --username '$oauthtoken' --password-stdin
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
docker pull "$SRC"
docker tag "$SRC" "$DEST"
docker push "$DEST"
echo "Pushed ${DEST}. NVIDIA's security scan and QA (steps 3 and 4) run next."
