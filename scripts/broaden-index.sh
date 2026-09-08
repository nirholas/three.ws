#!/usr/bin/env bash
# Builds breadth across the newly wired sources.
#
# Each of these covers something the dealer sources do not: Copart states a
# title brand on every lot, Craigslist is private-party supply and states owner
# counts, Carvana and duPont carry VINs that dedupe against everything else,
# and the auction sources produce the completed sales every market statistic
# rests on.
#
# Sequential per source: the throttle is per host and these do not share one,
# but running them together would put three browsers and a TLS client on the
# same egress IP at once, which is how a working source becomes a challenged one.
set -uo pipefail
cd "$(dirname "$0")/.."

run() {
  local label="$1"; shift
  echo "=== $label"
  timeout 900 npx tsx src/cli.ts search "$@" --concurrency 1 --no-enrich 2>&1 \
    | grep -E "kept |by source|integrity|FAILED" | head -6
}

# Salvage, for title-status coverage across the market rather than one marque.
for mk in Porsche BMW Mercedes-Benz Toyota Ford Chevrolet Honda Audi Jeep Lexus; do
  run "copart $mk" --make "$mk" --sources copart
done

# Retail inventory carrying VINs.
for mk in Porsche BMW Mercedes-Benz Toyota Ford; do
  run "carvana $mk" --make "$mk" --sources carvana
done

# Their URLs do not filter, so one broad pass is the whole catalogue.
run "dupont (broad)" --sources dupontregistry
run "pcarmarket (broad)" --sources pcarmarket
run "hagerty (broad)" --sources hagertymarketplace
