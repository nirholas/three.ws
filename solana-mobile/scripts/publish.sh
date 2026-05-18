#!/usr/bin/env bash
# Submit a new release of the three.ws app to the Solana dApp Store.
#
# Prerequisites:
#   - scripts/init-publisher.sh has been run once (publisher + app NFTs minted)
#   - scripts/build-apk.sh produced build/three-ws-release.apk
#   - publish/config.yaml is filled in with publisher.address and app.address
#   - .well-known/assetlinks.json is already live at https://three.ws/.well-known/assetlinks.json
#
# Usage:
#   SOLANA_KEYPAIR=~/.config/solana/id.json \
#   DAPP_STORE_API_KEY=... \
#   ./scripts/publish.sh
#
# Environment:
#   SOLANA_KEYPAIR        path to publishing keypair
#   SOLANA_RPC_URL        RPC endpoint (default: mainnet-beta)
#   DAPP_STORE_API_KEY    API key from Publisher Portal (required for submit)
#   APK_PATH              override APK path (default: build/three-ws-release.apk)
#   SUBMIT                if "1" (default), submits for review; "0" mints release NFT only
#   DAPP_STORE_DRYRUN     if "1", prints commands without executing

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

require() { command -v "$1" >/dev/null 2>&1 || { echo "[publish] missing $1" >&2; exit 1; }; }
require node
require npx

if [[ -z "${SOLANA_KEYPAIR:-}" ]]; then
	echo "[publish] SOLANA_KEYPAIR must be set" >&2; exit 1
fi
SUBMIT="${SUBMIT:-1}"
APK_PATH="${APK_PATH:-$(pwd)/build/three-ws-release.apk}"
if [[ ! -f "$APK_PATH" ]]; then
	echo "[publish] APK missing: $APK_PATH — run scripts/build-apk.sh first" >&2
	exit 1
fi
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
PUBLISH_DIR="$(pwd)/publish"

if ! npx --no-install @solana-mobile/dapp-store-cli --version >/dev/null 2>&1; then
	echo "[publish] installing @solana-mobile/dapp-store-cli"
	npm install --no-save @solana-mobile/dapp-store-cli@latest
fi

DAPP="npx --no-install @solana-mobile/dapp-store"

run() {
	echo "[publish] \$ $*"
	if [[ "${DAPP_STORE_DRYRUN:-0}" == "1" ]]; then return 0; fi
	"$@"
}

echo "[publish] verifying assetlinks.json is reachable"
if ! curl -sSfL -o /dev/null -m 10 "https://three.ws/.well-known/assetlinks.json"; then
	echo "[publish] WARNING: https://three.ws/.well-known/assetlinks.json is NOT reachable yet."
	echo "[publish] dApp Store review will fail without it. Continuing anyway."
fi

echo "[publish] minting release NFT (config: $PUBLISH_DIR/config.yaml)"
WHATS_NEW_FILE="$PUBLISH_DIR/listing/new-in-version.txt"
WHATS_NEW="$(cat "$WHATS_NEW_FILE" 2>/dev/null || echo 'Initial release.')"

run $DAPP create release \
	--keypair "$SOLANA_KEYPAIR" \
	--url "$SOLANA_RPC_URL" \
	-d "$PUBLISH_DIR" \
	--apk-file "$APK_PATH" \
	--whats-new "$WHATS_NEW"

if [[ "$SUBMIT" != "1" ]]; then
	echo "[publish] ✓ release NFT minted. SUBMIT=0 — skipping store submission."
	exit 0
fi

if [[ -z "${DAPP_STORE_API_KEY:-}" ]]; then
	echo "[publish] DAPP_STORE_API_KEY must be set to submit for review." >&2
	echo "[publish] Get one at https://publish.solanamobile.com → Settings." >&2
	exit 1
fi

echo "[publish] submitting release for review"
# Pass the API key via stdin so it never appears in process listings.
printf '%s\n' "$DAPP_STORE_API_KEY" | run $DAPP publish submit \
	--keypair "$SOLANA_KEYPAIR" \
	--url "$SOLANA_RPC_URL" \
	-d "$PUBLISH_DIR" \
	--requestor-is-authorized \
	--complies-with-solana-dapp-store-policies

echo "[publish] ✓ submitted. Track status at https://publish.solanamobile.com"
