#!/bin/bash
export X402_BUYER_PRIVATE_KEY=""
export X402_NETWORK="base"

ENDPOINTS=(
  "https://three.ws/api/x402/symbol-availability"
  "https://three.ws/api/x402/agent-reputation"
  "https://three.ws/api/x402/skill-marketplace"
  "https://three.ws/api/x402/pump-agent-audit"
  "https://three.ws/api/x402/onchain-identity-verify"
  "https://three.ws/api/x402/mint-to-mesh-batch"
  "https://three.ws/api/x402/model-check"
  "https://three.ws/api/x402/mint-to-mesh"
)

for TARGET in "${ENDPOINTS[@]}"; do
  echo "--- Triggering $TARGET ---"
  X402_TARGET=$TARGET node scripts/x402-first-paid-request.mjs
  echo ""
done
