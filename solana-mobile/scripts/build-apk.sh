#!/usr/bin/env bash
# Build a signed release APK for the three.ws Solana Mobile dApp Store
# listing. Requires Node 18-21, JDK 17, Android SDK (Bubblewrap auto-installs
# build-tools 33 if missing), and a release keystore.
#
# Usage:
#   ./scripts/build-apk.sh
#
# Environment:
#   KEYSTORE_PATH        path to release.keystore  (default: ./android.keystore)
#   KEYSTORE_PASSWORD    keystore password         (required)
#   KEY_ALIAS            release key alias         (default: threews)
#   KEY_PASSWORD         key password              (defaults to KEYSTORE_PASSWORD)
#   VERSION_NAME         appVersionName            (default: read from twa-manifest.json)
#   VERSION_CODE         appVersionCode            (default: read from twa-manifest.json)
#   ASSETLINKS_OUT       where to write the assetlinks.json from the fingerprint
#                        (default: ../public/.well-known/assetlinks.json)
#
# The script is idempotent: rerunning it bumps versionCode automatically if
# BUMP=1 is set, otherwise leaves the manifest alone.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

require() {
	command -v "$1" >/dev/null 2>&1 || { echo "[build-apk] missing required tool: $1" >&2; exit 1; }
}

require node
require npx
require java
require keytool

if [[ -z "${KEYSTORE_PASSWORD:-}" ]]; then
	echo "[build-apk] KEYSTORE_PASSWORD must be set" >&2
	exit 1
fi

KEYSTORE_PATH="${KEYSTORE_PATH:-$(pwd)/android.keystore}"
KEY_ALIAS="${KEY_ALIAS:-threews}"
KEY_PASSWORD="${KEY_PASSWORD:-$KEYSTORE_PASSWORD}"
ASSETLINKS_OUT="${ASSETLINKS_OUT:-$(cd .. && pwd)/public/.well-known/assetlinks.json}"

echo "[build-apk] working dir: $(pwd)"
echo "[build-apk] keystore: $KEYSTORE_PATH (alias=$KEY_ALIAS)"

# ── 1. Generate keystore if missing ────────────────────────────────────────
if [[ ! -f "$KEYSTORE_PATH" ]]; then
	echo "[build-apk] no keystore at $KEYSTORE_PATH — generating new RSA 2048 release key (valid 30 years)"
	keytool -genkeypair \
		-v \
		-keystore "$KEYSTORE_PATH" \
		-alias "$KEY_ALIAS" \
		-keyalg RSA \
		-keysize 2048 \
		-validity 10950 \
		-storepass "$KEYSTORE_PASSWORD" \
		-keypass "$KEY_PASSWORD" \
		-dname "CN=three.ws, OU=Mobile, O=three.ws, L=Internet, ST=NA, C=US"
fi

# ── 2. Extract SHA-256 fingerprint and write assetlinks.json ───────────────
FINGERPRINT="$(
	keytool -list -v \
		-keystore "$KEYSTORE_PATH" \
		-alias "$KEY_ALIAS" \
		-storepass "$KEYSTORE_PASSWORD" \
		2>/dev/null \
	| awk -F': ' '/SHA256:/ { print $2; exit }' \
	| tr -d ' '
)"

if [[ -z "$FINGERPRINT" ]]; then
	echo "[build-apk] failed to extract SHA-256 fingerprint from keystore" >&2
	exit 1
fi

echo "[build-apk] SHA-256: $FINGERPRINT"

mkdir -p "$(dirname "$ASSETLINKS_OUT")"
PACKAGE_ID=$(node -e "console.log(require('./twa/twa-manifest.json').packageId)")
node <<NODE > "$ASSETLINKS_OUT"
const links = [{
  relation: [
    'delegate_permission/common.handle_all_urls',
    'delegate_permission/common.use_as_origin',
  ],
  target: {
    namespace: 'android_app',
    package_name: '${PACKAGE_ID}',
    sha256_cert_fingerprints: ['${FINGERPRINT}'],
  },
}];
process.stdout.write(JSON.stringify(links, null, 2) + '\n');
NODE

echo "[build-apk] wrote assetlinks.json → $ASSETLINKS_OUT"

# ── 3. Install Bubblewrap CLI locally if missing ───────────────────────────
if ! npx --no-install @bubblewrap/cli --version >/dev/null 2>&1; then
	echo "[build-apk] installing @bubblewrap/cli locally"
	npm install --no-save @bubblewrap/cli@latest
fi

BUBBLEWRAP="npx --no-install @bubblewrap/cli"

# ── 4. Init or update the TWA project ──────────────────────────────────────
BUILD_DIR="$(pwd)/build"
mkdir -p "$BUILD_DIR"
cp -f twa/twa-manifest.json "$BUILD_DIR/twa-manifest.json"
cp -f "$KEYSTORE_PATH" "$BUILD_DIR/android.keystore"

pushd "$BUILD_DIR" >/dev/null

if [[ -f app-release-signed.apk ]]; then
	rm -f app-release-signed.apk
fi

if [[ ! -f app/build.gradle && ! -f build.gradle ]]; then
	echo "[build-apk] running bubblewrap init"
	$BUBBLEWRAP init --manifest "$(pwd)/twa-manifest.json" --skipPwaValidation
else
	echo "[build-apk] running bubblewrap update"
	$BUBBLEWRAP update --skipVersionUpgrade
fi

# Patch build.gradle to declare resConfigs (avoids the Bubblewrap all-locales
# bug that lists every Android locale on the dApp Store listing).
GRADLE_FILE="app/build.gradle"
[[ -f "$GRADLE_FILE" ]] || GRADLE_FILE="build.gradle"
if [[ -f "$GRADLE_FILE" ]] && ! grep -q "resConfigs" "$GRADLE_FILE"; then
	node <<NODE
const fs = require('fs');
const p = '${GRADLE_FILE}';
const src = fs.readFileSync(p, 'utf8');
const patched = src.replace(
	/(defaultConfig\s*\{[^}]*?versionName[^\n]*\n)/,
	(m) => m + '        resConfigs "en"\n',
);
fs.writeFileSync(p, patched);
console.log('[build-apk] patched ' + p + ' with resConfigs "en"');
NODE
fi

# ── 5. Build & sign the APK ────────────────────────────────────────────────
echo "[build-apk] building signed release APK"
$BUBBLEWRAP build \
	--skipPwaValidation \
	--signingKeyPath "$(pwd)/android.keystore" \
	--signingKeyAlias "$KEY_ALIAS" <<< "$(printf '%s\n%s\n' "$KEYSTORE_PASSWORD" "$KEY_PASSWORD")"

APK_PATH=""
for candidate in app-release-signed.apk app/build/outputs/apk/release/app-release-signed.apk; do
	if [[ -f "$candidate" ]]; then
		APK_PATH="$(pwd)/$candidate"
		break
	fi
done

if [[ -z "$APK_PATH" ]]; then
	echo "[build-apk] ERROR: signed APK not found after build" >&2
	exit 1
fi

popd >/dev/null

# ── 6. Verify signature ────────────────────────────────────────────────────
APKSIGNER="$(command -v apksigner || true)"
if [[ -n "$APKSIGNER" ]]; then
	echo "[build-apk] verifying APK signature"
	"$APKSIGNER" verify --print-certs "$APK_PATH"
else
	echo "[build-apk] apksigner not on PATH — skipping signature verification"
fi

OUT="$(pwd)/build/three-ws-release.apk"
cp -f "$APK_PATH" "$OUT"
echo "[build-apk] ✓ signed APK ready: $OUT"
echo "[build-apk] next: deploy assetlinks.json, then run scripts/publish.sh"
