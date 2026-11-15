#!/usr/bin/env bash
# The X content runner, unattended. X_RUNNER_TASK picks the job:
#
#   partners (default)  one day of the partner spotlight:
#     1. materialize production's overlay, so the rotation sees every spotlight
#        already shipped, not only the ones in this image's queue.json;
#     2. keep X_PARTNERS_DAYS days in stock: film, draft, review, and ship what
#        the approval policy releases as signed bundles production reads.
#
#   refill  the queue's own upkeep (scripts/x-content.mjs advance --refresh):
#     films, reviews and releases drafts by policy, renews every approved post
#     whose reel, head or review expired before it could go out, alerts on what
#     it could not renew, and ships the result as bundles.
set -euo pipefail
cd "$(dirname "$0")/../.."

case "${X_RUNNER_TASK:-partners}" in
	partners)
		overlay="$(mktemp -d)"
		days="${X_PARTNERS_DAYS:-3}"
		node scripts/x-bundle.mjs pull --dir "$overlay"
		exec node scripts/x-partners.mjs daily --days "$days" --overlay "$overlay" --ship
		;;
	refill)
		exec node scripts/x-content.mjs advance --refresh --ship
		;;
	*)
		echo "run.sh: X_RUNNER_TASK must be partners or refill, not ${X_RUNNER_TASK}" >&2
		exit 2
		;;
esac
