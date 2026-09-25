#!/usr/bin/env bash
# Build, sign, notarize and publish the macOS half of a three.ws Desktop release.
#
# Runs on a Mac (Xcode command line tools, Node 20+, gcloud signed in to
# aerial-vehicle-466722-p5). Cloud Build has no macOS workers, and a universal
# binary (lipo) and notarization (notarytool) need Apple's toolchain.
#
#   bash apps/desktop/scripts/release-mac.sh            # build and stage only
#   PUBLISH=1 bash apps/desktop/scripts/release-mac.sh  # also publish (owner-gated)
#
# Signing comes from Secret Manager when the secrets exist:
#   desktop-macos-csc-link       Developer ID Application certificate (.p12, base64)
#   desktop-macos-csc-password   its password
#   desktop-apple-api-key        App Store Connect API key (.p8 contents) for notarization
#   desktop-apple-api-key-id     its key id
#   desktop-apple-api-issuer     its issuer id
# Without them the app is ad-hoc signed and not notarized; /desktop then shows
# the "Open Anyway" steps. The release merges into the release.json that the
# Linux and Windows build published, so run it after apps/desktop/cloudbuild.yaml.

set -euo pipefail

PROJECT="${PROJECT:-aerial-vehicle-466722-p5}"
BUCKET="${BUCKET:-three-ws-desktop-releases}"
PUBLISH="${PUBLISH:-0}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '[release-mac] %s\n' "$*"; }
die() { printf '[release-mac] error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "run this on macOS; Linux and Windows build on Cloud Build (apps/desktop/cloudbuild.yaml)"
command -v gcloud >/dev/null || die "gcloud is required (https://cloud.google.com/sdk/docs/install)"
command -v node >/dev/null || die "Node 20+ is required"

secret() { gcloud secrets versions access latest --secret="$1" --project="$PROJECT" 2>/dev/null; }

export THREE_WS_SIGNED_MAC=0
if CSC_LINK="$(secret desktop-macos-csc-link)" && CSC_KEY_PASSWORD="$(secret desktop-macos-csc-password)"; then
	export CSC_LINK CSC_KEY_PASSWORD
	export THREE_WS_SIGNED_MAC=1
	log "Developer ID certificate found: signing"
	if secret desktop-apple-api-key > "$WORK/AuthKey.p8" && APPLE_API_KEY_ID="$(secret desktop-apple-api-key-id)" && APPLE_API_ISSUER="$(secret desktop-apple-api-issuer)"; then
		export APPLE_API_KEY="$WORK/AuthKey.p8" APPLE_API_KEY_ID APPLE_API_ISSUER
		log "App Store Connect key found: notarizing"
	else
		log "no App Store Connect key: signed but not notarized, Gatekeeper will still warn"
	fi
else
	unset CSC_LINK CSC_KEY_PASSWORD
	export CSC_IDENTITY_AUTO_DISCOVERY=false
	log "no Developer ID certificate in Secret Manager: ad-hoc signing (users follow the Open Anyway steps)"
fi

cd "$APP_DIR"
VERSION="$(node -p "require('./package.json').version")"
log "three.ws Desktop $VERSION"
npm ci --no-audit --no-fund
rm -rf dist
npx electron-builder --config electron-builder.config.cjs --mac --publish never

if ! gcloud storage cp "gs://$BUCKET/releases/desktop/release.json" "$WORK/published.json" 2>/dev/null; then
	echo '{}' > "$WORK/published.json"
fi
node scripts/release-manifest.mjs --merge "$WORK/published.json"

shopt -s nullglob
BINARIES=(dist/*.dmg dist/*.zip dist/*.blockmap)
FEED_FILES=(dist/latest-mac.yml dist/release.json)
STAGE="gs://$BUCKET/staging/$VERSION/mac-$(date +%s)"
gcloud storage cp "${BINARIES[@]}" "${FEED_FILES[@]}" "$STAGE/"
log "staged at $STAGE/"

if [ "$PUBLISH" != "1" ]; then
	log "dry run: the live feed is unchanged. Publish with PUBLISH=1 once the owner approves."
	exit 0
fi
LIVE="gs://$BUCKET/releases/desktop"
gcloud storage cp "${BINARIES[@]}" "$LIVE/" --cache-control="public, max-age=31536000, immutable"
gcloud storage cp dist/release.json "$LIVE/versions/$VERSION.json" --cache-control="public, max-age=300"
gcloud storage cp "${FEED_FILES[@]}" "$LIVE/" --cache-control="no-cache, max-age=0"
log "published macOS $VERSION to https://three.ws/releases/desktop/"
