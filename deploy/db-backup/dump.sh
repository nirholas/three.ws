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
# Parallel workers take their table locks with NOWAIT, so a cron that briefly
# holds an ACCESS EXCLUSIVE lock (a truncate or prune) aborts the dump. Retry,
# and make the last attempt a single-process dump that waits for locks instead.
attempt=1
until
	started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	if [ $attempt -lt 3 ]; then
		pg_dump "$DATABASE_URL" --format=directory --jobs=6 --compress=6 --no-owner --no-privileges --file="$OUT/dump"
	else
		pg_dump "$DATABASE_URL" --format=directory --jobs=1 --compress=6 --no-owner --no-privileges --lock-wait-timeout=120000 --file="$OUT/dump"
	fi
do
	[ $attempt -lt 3 ] || { echo "pg_dump failed after $attempt attempts"; exit 1; }
	echo "pg_dump attempt $attempt failed; retrying"
	rm -rf "$OUT/dump"
	attempt=$((attempt + 1))
	sleep 20
done
t1=$(date +%s)
after=$(counts)

tar -cf "$OUT/neondb.tar" -C "$OUT" dump
rm -rf "$OUT/dump"
bytes=$(stat -c %s "$OUT/neondb.tar")
sha=$(sha256sum "$OUT/neondb.tar" | cut -d' ' -f1)

cat > "$OUT/source.json" <<JSON
{"snapshot_started_at":"$started","dump_seconds":$((t1 - t0)),"dump_attempts":$attempt,"archive_bytes":$bytes,"archive_sha256":"$sha","server_version":"$server","source_tables":$tables,"counts_before_dump":$before,"counts_after_dump":$after}
JSON
cat "$OUT/source.json"
