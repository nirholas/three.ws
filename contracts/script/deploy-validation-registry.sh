#!/usr/bin/env bash
# Deploy ValidationRegistry to all 15 mainnet chains.
#
# Prerequisites
# -------------
# 1. Set env vars:
#      DEPLOYER_PRIVATE_KEY   — hex private key (same key on EVERY chain)
#      DEPLOYER_ADDRESS       — matching public address (for dry-runs)
#      ETH_RPC_URL, OP_RPC_URL, BSC_RPC_URL, GNOSIS_RPC_URL, POLYGON_RPC_URL,
#      FANTOM_RPC_URL, ZKSYNC_RPC_URL, MOONBEAM_RPC_URL, MANTLE_RPC_URL,
#      BASE_RPC_URL, ARB_RPC_URL, CELO_RPC_URL, AVAX_RPC_URL,
#      LINEA_RPC_URL, SCROLL_RPC_URL
#      ETHERSCAN_API_KEY (and chain-specific keys where needed — see per-chain notes)
#
# 2. Dry-run first (no --broadcast) to confirm the predicted address:
#      bash deploy-validation-registry.sh --dry-run
#
# IMPORTANT: The deployed address is deterministic per deployer address.
#   Run `computeAddress(DEPLOYER_ADDRESS)` on any chain to pre-verify the address
#   before broadcasting:
#     forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
#       --rpc-url $ETH_RPC_URL --sender $DEPLOYER_ADDRESS
#
# The address will be the same on all chains only if:
#   - The same DEPLOYER_PRIVATE_KEY is used on every chain
#   - Nick's CREATE2 factory (0x4e59b44847b379578588920cA78FbF26c0B4956C) is
#     deployed on each chain (it is, on all listed chains)

set -euo pipefail

SCRIPT="script/DeployValidationMainnet.s.sol:DeployValidationMainnet"
BROADCAST_FLAGS="--broadcast --verify"
DRY_RUN="${1:-}"

run_deploy() {
    local chain="$1"
    local rpc_url="$2"
    local api_key_flag="$3"
    local extra_flags="${4:-}"

    echo ""
    echo "=========================================="
    echo " Deploying to: $chain"
    echo "=========================================="

    if [ "$DRY_RUN" = "--dry-run" ]; then
        forge script "$SCRIPT" \
            --rpc-url "$rpc_url" \
            --sender "$DEPLOYER_ADDRESS"
    else
        # shellcheck disable=SC2086
        forge script "$SCRIPT" \
            --rpc-url "$rpc_url" \
            --private-key "$DEPLOYER_PRIVATE_KEY" \
            $BROADCAST_FLAGS \
            $api_key_flag \
            $extra_flags
    fi
}

# ---------------------------------------------------------------------------
# Ethereum (chainId 1)
# Explorer: https://etherscan.io
# ---------------------------------------------------------------------------
run_deploy "Ethereum (1)" \
    "$ETH_RPC_URL" \
    "--etherscan-api-key $ETHERSCAN_API_KEY"

# ---------------------------------------------------------------------------
# Optimism (chainId 10)
# Explorer: https://optimistic.etherscan.io
# API key: same Etherscan account works, or set OPTIMISM_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Optimism (10)" \
    "$OP_RPC_URL" \
    "--etherscan-api-key ${OPTIMISM_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api-optimistic.etherscan.io/api"

# ---------------------------------------------------------------------------
# BNB Smart Chain (chainId 56)
# Explorer: https://bscscan.com  — needs BSC_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "BNB Smart Chain (56)" \
    "$BSC_RPC_URL" \
    "--etherscan-api-key ${BSC_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.bscscan.com/api"

# ---------------------------------------------------------------------------
# Gnosis (chainId 100)
# Explorer: https://gnosisscan.io  — needs GNOSIS_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Gnosis (100)" \
    "$GNOSIS_RPC_URL" \
    "--etherscan-api-key ${GNOSIS_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.gnosisscan.io/api"

# ---------------------------------------------------------------------------
# Polygon (chainId 137)
# Explorer: https://polygonscan.com  — needs POLYGON_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Polygon (137)" \
    "$POLYGON_RPC_URL" \
    "--etherscan-api-key ${POLYGON_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.polygonscan.com/api"

# ---------------------------------------------------------------------------
# Fantom (chainId 250)
# Explorer: https://ftmscan.com  — needs FANTOM_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Fantom (250)" \
    "$FANTOM_RPC_URL" \
    "--etherscan-api-key ${FANTOM_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.ftmscan.com/api"

# ---------------------------------------------------------------------------
# zkSync Era (chainId 324)
# NOTE: zkSync uses a different EVM and compiler; standard Foundry CREATE2
# may behave differently. Verify the predicted address carefully before
# broadcasting. Explorer: https://explorer.zksync.io
# ---------------------------------------------------------------------------
run_deploy "zkSync Era (324)" \
    "$ZKSYNC_RPC_URL" \
    "--etherscan-api-key ${ZKSYNC_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://zksync2-mainnet-explorer.zksync.io/contract_verification"

# ---------------------------------------------------------------------------
# Moonbeam (chainId 1284)
# Explorer: https://moonscan.io  — needs MOONBEAM_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Moonbeam (1284)" \
    "$MOONBEAM_RPC_URL" \
    "--etherscan-api-key ${MOONBEAM_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api-moonbeam.moonscan.io/api"

# ---------------------------------------------------------------------------
# Mantle (chainId 5000)
# Explorer: https://explorer.mantle.xyz  — needs MANTLE_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Mantle (5000)" \
    "$MANTLE_RPC_URL" \
    "--etherscan-api-key ${MANTLE_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://explorer.mantle.xyz/api"

# ---------------------------------------------------------------------------
# Base (chainId 8453)
# Explorer: https://basescan.org  — BASESCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Base (8453)" \
    "$BASE_RPC_URL" \
    "--etherscan-api-key ${BASESCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.basescan.org/api"

# ---------------------------------------------------------------------------
# Arbitrum One (chainId 42161)
# Explorer: https://arbiscan.io  — needs ARB_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Arbitrum One (42161)" \
    "$ARB_RPC_URL" \
    "--etherscan-api-key ${ARB_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.arbiscan.io/api"

# ---------------------------------------------------------------------------
# Celo (chainId 42220)
# Explorer: https://celoscan.io  — needs CELO_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Celo (42220)" \
    "$CELO_RPC_URL" \
    "--etherscan-api-key ${CELO_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.celoscan.io/api"

# ---------------------------------------------------------------------------
# Avalanche C-Chain (chainId 43114)
# Explorer: https://snowtrace.io  — needs AVAX_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Avalanche C-Chain (43114)" \
    "$AVAX_RPC_URL" \
    "--etherscan-api-key ${AVAX_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.snowtrace.io/api"

# ---------------------------------------------------------------------------
# Linea (chainId 59144)
# Explorer: https://lineascan.build  — needs LINEA_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Linea (59144)" \
    "$LINEA_RPC_URL" \
    "--etherscan-api-key ${LINEA_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.lineascan.build/api"

# ---------------------------------------------------------------------------
# Scroll (chainId 534352)
# Explorer: https://scrollscan.com  — needs SCROLL_ETHERSCAN_API_KEY
# ---------------------------------------------------------------------------
run_deploy "Scroll (534352)" \
    "$SCROLL_RPC_URL" \
    "--etherscan-api-key ${SCROLL_ETHERSCAN_API_KEY:-$ETHERSCAN_API_KEY}" \
    "--verifier-url https://api.scrollscan.com/api"

echo ""
echo "=========================================="
echo " All chains attempted."
echo " Verify each deployment with:"
echo "   cast call --rpc-url \$RPC 0x<DEPLOYED_ADDR> \"owner()(address)\""
echo "=========================================="
