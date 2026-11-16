#!/usr/bin/env bash
# Build the three.ws GPU quickstart image from a staged context.
#
#   build.sh local [tag]   docker build on this machine (needs ~40 GB free disk)
#   build.sh cloud         Cloud Build, pushes to Artifact Registry (private until published)
#   build.sh context DIR   only stage the context into DIR (used by setup.sh's source build)
#
# The context is this directory plus the node operator client from
# packages/node-operator. Staging it keeps the upload to a few hundred KB
# instead of the whole monorepo.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MODE="${1:-}"
VERSION="$(sed -n 's/^  _VERSION: "\(.*\)"$/\1/p' "$HERE/cloudbuild.yaml")"

stage() {
  local dest="$1"
  mkdir -p "$dest/node-operator"
  cp "$HERE/Dockerfile" "$HERE/cloudbuild.yaml" "$HERE/LICENSES.md" "$dest/"
  cp -r "$HERE/image" "$dest/image"
  find "$dest/image" -name '__pycache__' -type d -prune -exec rm -rf {} +
  cp "$REPO/packages/node-operator/package.json" "$REPO/packages/node-operator/package-lock.json" "$dest/node-operator/"
  cp -r "$REPO/packages/node-operator/src" "$dest/node-operator/src"
}

case "$MODE" in
  context)
    [[ -n "${2:-}" ]] || { echo "usage: build.sh context DIR" >&2; exit 2; }
    stage "$2"
    echo "context staged in $2"
    ;;
  local)
    TAG="${2:-three-ws/gpu-quickstart:$VERSION}"
    CTX="$(mktemp -d)"
    trap 'rm -rf "$CTX"' EXIT
    stage "$CTX"
    DOCKER_BUILDKIT=1 docker build --progress=plain -t "$TAG" "$CTX"
    echo "built $TAG"
    ;;
  cloud)
    # The root disk on the dev box is nearly full; gcloud stages the upload in TMPDIR.
    export TMPDIR="${TMPDIR_OVERRIDE:-$HOME/.cache/gcloud-tmp}"
    mkdir -p "$TMPDIR"
    CTX="$(mktemp -d)"
    trap 'rm -rf "$CTX"' EXIT
    stage "$CTX"
    gcloud builds submit "$CTX" \
      --project aerial-vehicle-466722-p5 \
      --region us-central1 \
      --config "$CTX/cloudbuild.yaml" \
      --substitutions "_VERSION=$VERSION"
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
