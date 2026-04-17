#!/usr/bin/env bash
# CZ Demo Health-Check Script
# Usage: scripts/cz-demo/runbook.sh {check|warm|stop}
#
# check   — verify all demo dependencies (staging up, API working, chain state, etc.)
# warm    — pre-warm caches by hitting all demo URLs
# stop    — gracefully disable public traffic (stub for now)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration — set these before running
STAGING_URL="${STAGING_URL:-http://localhost:3000}"
CHAIN_ID="${CHAIN_ID:-84532}"  # Base Sepolia
BLOCK_EXPLORER="${BLOCK_EXPLORER:-https://sepolia.basescan.org}"
RPC_ENDPOINT="${RPC_ENDPOINT:-https://sepolia.base.org}"

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

log_pass() {
	echo -e "${GREEN}✓${NC} $1"
	((CHECKS_PASSED++))
}

log_fail() {
	echo -e "${RED}✗${NC} $1"
	((CHECKS_FAILED++))
}

log_info() {
	echo -e "${BLUE}ℹ${NC} $1"
}

log_warn() {
	echo -e "${YELLOW}⚠${NC} $1"
}

# ============================================================================
# COMMAND: check
# ============================================================================

cmd_check() {
	echo -e "${BLUE}CZ Demo Health Check${NC}"
	echo "Staging URL: $STAGING_URL"
	echo "RPC Endpoint: $RPC_ENDPOINT"
	echo "---"

	# 1. Staging /cz endpoint
	echo -n "Checking /cz endpoint... "
	if curl -sf "$STAGING_URL/cz" > /dev/null 2>&1; then
		log_pass "/cz endpoint reachable"
	else
		log_fail "/cz endpoint not reachable (HTTP error or timeout)"
	fi

	# 2. Avatar file exists
	echo -n "Checking avatar GLB... "
	if curl -sI "$STAGING_URL/avatars/cz.glb" 2>/dev/null | grep -q "200 OK"; then
		AVATAR_SIZE=$(curl -sI "$STAGING_URL/avatars/cz.glb" 2>/dev/null | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
		if [ -z "$AVATAR_SIZE" ]; then
			log_warn "/avatars/cz.glb exists but size unknown"
		elif [ "$AVATAR_SIZE" -lt 1000000 ] || [ "$AVATAR_SIZE" -gt 20000000 ]; then
			log_warn "/avatars/cz.glb size out of expected range: $AVATAR_SIZE bytes"
		else
			log_pass "/avatars/cz.glb exists (${AVATAR_SIZE} bytes)"
		fi
	else
		log_fail "/avatars/cz.glb not found or CORS blocked (HTTP error)"
	fi

	# 3. CZ state endpoint
	echo -n "Checking /cz/state.json... "
	STATE_RESPONSE=$(curl -s "$STAGING_URL/cz/state.json" 2>/dev/null || echo "{}")
	if echo "$STATE_RESPONSE" | grep -q "status"; then
		STATUS=$(echo "$STATE_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
		log_pass "/cz/state.json responds (status: $STATUS)"
	else
		log_fail "/cz/state.json not found or invalid JSON"
	fi

	# 4. API health
	echo -n "Checking /api/config endpoint... "
	if curl -sf "$STAGING_URL/api/config" > /dev/null 2>&1; then
		log_pass "/api/config endpoint reachable"
	else
		log_fail "/api/config endpoint not reachable (HTTP error)"
	fi

	# 5. CZ identity endpoint (may be 404 if pre-onchain)
	echo -n "Checking /api/cz/identity endpoint... "
	IDENTITY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$STAGING_URL/api/cz/identity" 2>/dev/null)
	if [ "$IDENTITY_STATUS" = "200" ]; then
		AGENT_ID=$(curl -s "$STAGING_URL/api/cz/identity" 2>/dev/null | grep -o '"agentId":"[^"]*"' | cut -d'"' -f4)
		log_pass "/api/cz/identity responds (agentId: ${AGENT_ID:0:8}…)"
	elif [ "$IDENTITY_STATUS" = "404" ]; then
		log_warn "/api/cz/identity returns 404 (agent not yet registered on-chain)"
	else
		log_fail "/api/cz/identity returned HTTP $IDENTITY_STATUS"
	fi

	# 6. RPC connectivity
	echo -n "Checking RPC endpoint... "
	if RPC_RESPONSE=$(curl -s -X POST "$RPC_ENDPOINT" \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null); then
		if echo "$RPC_RESPONSE" | grep -q "result"; then
			BLOCK_HEX=$(echo "$RPC_RESPONSE" | grep -o '"result":"0x[^"]*"' | cut -d'"' -f4)
			BLOCK_DEC=$((16#${BLOCK_HEX:2}))
			log_pass "RPC endpoint responding (latest block: $BLOCK_DEC)"
		else
			log_fail "RPC endpoint returned invalid JSON or error"
		fi
	else
		log_fail "RPC endpoint not reachable (connection timeout)"
	fi

	# 7. Offline fallback exists
	echo -n "Checking offline fallback... "
	if curl -sf "$STAGING_URL/cz/offline/index.html" > /dev/null 2>&1; then
		log_pass "/cz/offline/index.html exists and is accessible"
	else
		log_fail "/cz/offline/index.html not found (HTTP error)"
	fi

	# 8. Browser cache warm-up suggestion
	echo ""
	log_info "Tip: Pre-load /cz in your browser 30 min before demo to warm caches"

	# Summary
	echo ""
	echo -e "${BLUE}Summary${NC}"
	echo -e "Passed: ${GREEN}${CHECKS_PASSED}${NC} | Failed: ${RED}${CHECKS_FAILED}${NC}"
	echo ""

	if [ $CHECKS_FAILED -eq 0 ]; then
		echo -e "${GREEN}All checks passed! Ready for demo.${NC}"
		exit 0
	else
		echo -e "${RED}Some checks failed. Review above and fix before proceeding.${NC}"
		exit 1
	fi
}

# ============================================================================
# COMMAND: warm
# ============================================================================

cmd_warm() {
	echo -e "${BLUE}CZ Demo Cache Warm-Up${NC}"
	echo "Loading all demo URLs to warm browser and CDN caches..."
	echo "---"

	# List of URLs to pre-load
	URLS=(
		"$STAGING_URL/cz"
		"$STAGING_URL/avatars/cz.glb"
		"$STAGING_URL/cz/state.json"
		"$STAGING_URL/api/config"
		"$STAGING_URL/api/cz/identity"
		"$STAGING_URL/cz/offline/index.html"
	)

	SUCCESS=0
	FAILED=0

	for URL in "${URLS[@]}"; do
		echo -n "Warming $URL... "
		if curl -sf "$URL" > /dev/null 2>&1; then
			echo -e "${GREEN}OK${NC}"
			((SUCCESS++))
		else
			echo -e "${RED}FAIL${NC}"
			((FAILED++))
		fi
		# Small delay to avoid hammering the server
		sleep 0.5
	done

	echo ""
	echo -e "${BLUE}Warm-up complete${NC}"
	echo -e "Successful: ${GREEN}${SUCCESS}${NC} | Failed: ${RED}${FAILED}${NC}"

	if [ $FAILED -eq 0 ]; then
		echo -e "${GREEN}Caches warmed. Demo ready to start.${NC}"
		exit 0
	else
		echo -e "${YELLOW}Some URLs failed to load. Check connectivity.${NC}"
		exit 1
	fi
}

# ============================================================================
# COMMAND: stop
# ============================================================================

cmd_stop() {
	echo -e "${BLUE}CZ Demo Stop Command${NC}"
	echo "---"
	log_info "Gracefully disabling public traffic (stub implementation)"
	echo ""
	echo "In a future release, this will:"
	echo "  - Set a feature flag to enable 'maintenance mode'"
	echo "  - Return 503 Service Unavailable with a scheduled-restart message"
	echo "  - Allow the operator to continue using the demo internally"
	echo ""
	echo "For now, manual steps:"
	echo "  1. In Vercel dashboard, set CZ_DEMO_ACTIVE=false in environment"
	echo "  2. Redeploy or wait for next build"
	echo "  3. Public traffic sees the fallback page"
	echo ""
	log_warn "This is a stub. Implement as part of the next demo cycle."
	exit 0
}

# ============================================================================
# MAIN
# ============================================================================

COMMAND="${1:-check}"

case "$COMMAND" in
	check)
		cmd_check
		;;
	warm)
		cmd_warm
		;;
	stop)
		cmd_stop
		;;
	*)
		echo "Usage: $0 {check|warm|stop}"
		echo ""
		echo "Commands:"
		echo "  check   Verify all demo dependencies (endpoints, avatars, chain state)"
		echo "  warm    Pre-load all demo URLs to warm caches"
		echo "  stop    Gracefully disable public traffic (stub)"
		echo ""
		exit 1
		;;
esac
