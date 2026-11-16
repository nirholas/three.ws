#!/usr/bin/env bash
# Step 1 of the daily database backup (deploy/db-backup/README.md).
# Runs in pgvector/pgvector:pg17 with DATABASE_URL (the unpooled Neon URL)
# from Secret Manager. Writes /workspace/out/neondb.tar (a pg_dump directory
# archive) and /workspace/out/source.json (timings and source row counts).
set -euo pipefail

OUT=/workspace/out
mkdir -p "$OUT"
CRITICAL="users user_wallets sessions api_keys agent_identities avatars subscriptions audit_log economy_master_ledger pump_agent_mints"

counts() {
	local first=1
	printf '{'
	for t in $CRITICAL; do
		n=$(psql "$DATABASE_URL" -XAtqc "select count(*) from public.\"$t\"")
		[ $first -eq 1 ] || printf ','
		printf '"%s":%s' "$t" "$n"
		first=0
	done
	printf '}'
}

tables=$(psql "$DATABASE_URL" -XAtqc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")
server=$(psql "$DATABASE_URL" -XAtqc "show server_version")
before=$(counts)

started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
t0=$(date +%s)
pg_dump "$DATABASE_URL" --format=directory --jobs=6 --compress=6 --no-owner --no-privileges --file="$OUT/dump"
t1=$(date +%s)
after=$(counts)

tar -cf "$OUT/neondb.tar" -C "$OUT" dump
rm -rf "$OUT/dump"
bytes=$(stat -c %s "$OUT/neondb.tar")
sha=$(sha256sum "$OUT/neondb.tar" | cut -d' ' -f1)

cat > "$OUT/source.json" <<JSON
{"snapshot_started_at":"$started","dump_seconds":$((t1 - t0)),"archive_bytes":$bytes,"archive_sha256":"$sha","server_version":"$server","source_tables":$tables,"counts_before_dump":$before,"counts_after_dump":$after}
JSON
cat "$OUT/source.json"
