#!/usr/bin/env bash
# One-time bootstrap for the three.ws Solana dApp Store presence.
#
# Mints (or re-uses) the three on-chain NFTs the dApp Store registry expects:
#   1. Publisher NFT — identifies the org/account that owns the listing
#   2. App NFT       — identifies the three.ws application
#   3. Release NFT   — created on every release, NOT by this script
#
# Run this exactly once per environment (mainnet vs. devnet). The created
# Mint Address values get written into publish/config.yaml so subsequent
# publishes know where to append releases.
#
# Usage:
#   SOLANA_KEYPAIR=~/.config/solana/id.json ./scripts/init-publisher.sh
#
# Environment:
#   SOLANA_KEYPAIR     path to Solana keypair (must hold ~0.2 SOL)
#   SOLANA_RPC_URL     RPC endpoint (default: https://api.mainnet-beta.solana.com)
#   DAPP_STORE_DRYRUN  if set to 1, prints commands without executing them

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -z "${SOLANA_KEYPAIR:-}" ]]; then
	echo "[init-publisher] SOLANA_KEYPAIR must be set (path to the publishing keypair)" >&2
	exit 1
fi
if [[ ! -f "$SOLANA_KEYPAIR" ]]; then
	echo "[init-publisher] keypair not found at $SOLANA_KEYPAIR" >&2
	exit 1
fi

SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
PUBLISH_DIR="$(pwd)/publish"
CFG="$PUBLISH_DIR/config.yaml"

run() {
	echo "[init-publisher] \$ $*"
	if [[ "${DAPP_STORE_DRYRUN:-0}" == "1" ]]; then return 0; fi
	"$@"
}

if ! npx --no-install @solana-mobile/dapp-store-cli --version >/dev/null 2>&1; then
	echo "[init-publisher] installing @solana-mobile/dapp-store-cli"
	run npm install --no-save @solana-mobile/dapp-store-cli@latest
fi

DAPP="npx --no-install @solana-mobile/dapp-store"

if [[ ! -f "$CFG" ]]; then
	echo "[init-publisher] $CFG missing — generating scaffold via dapp-store init"
	cd "$PUBLISH_DIR"
	run $DAPP init
	cd - >/dev/null
fi

echo "[init-publisher] minting publisher NFT"
run $DAPP create publisher \
	--keypair "$SOLANA_KEYPAIR" \
	--url "$SOLANA_RPC_URL" \
	-d "$PUBLISH_DIR"

echo "[init-publisher] minting app NFT"
run $DAPP create app \
	--keypair "$SOLANA_KEYPAIR" \
	--url "$SOLANA_RPC_URL" \
	-d "$PUBLISH_DIR"

echo "[init-publisher] ✓ publisher + app NFTs minted"
echo "[init-publisher] config.yaml now has 'address:' fields populated — commit them."
echo "[init-publisher] next: scripts/build-apk.sh, then scripts/publish.sh"
