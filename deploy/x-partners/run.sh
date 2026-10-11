#!/usr/bin/env bash
# One day of the partner spotlight, unattended.
#
# 1. Materialize production's overlay, so the rotation sees every spotlight
#    already shipped, not only the ones in this image's queue.json.
# 2. Keep X_PARTNERS_DAYS days in stock: film, draft, review, and ship what the
#    approval policy releases as signed bundles production reads.
set -euo pipefail
cd "$(dirname "$0")/../.."

overlay="$(mktemp -d)"
days="${X_PARTNERS_DAYS:-3}"

node scripts/x-bundle.mjs pull --dir "$overlay"
exec node scripts/x-partners.mjs daily --days "$days" --overlay "$overlay" --ship
