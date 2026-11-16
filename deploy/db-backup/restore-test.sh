#!/usr/bin/env bash
# Step 4 of the daily database backup (deploy/db-backup/README.md).
# Runs in pgvector/pgvector:pg17. Restores the archive that step 3 downloaded
# back from Cloud Storage into a brand-new local Postgres 17 cluster, then
# checks it against the source. Always writes /workspace/out/report.json with
# "ok": true or false; the publish step uploads it and fails the build on false.
set -euo pipefail

OUT=/workspace/out
SRC="$OUT/source.json"
CRITICAL="users user_wallets sessions api_keys agent_identities avatars subscriptions audit_log economy_master_ledger pump_agent_mints"
export PGDATA=/workspace/pgdata

download_seconds=$(cat "$OUT/download_seconds")
upload_seconds=$(cat "$OUT/upload_seconds")
object=$(cat "$OUT/object")
want_sha=$(sed -E 's/.*"archive_sha256":"([0-9a-f]+)".*/\1/' "$SRC")
got_sha=$(sha256sum "$OUT/restore/neondb.tar" | cut -d' ' -f1)
if [ "$want_sha" != "$got_sha" ]; then
	echo "checksum mismatch after download: $want_sha vs $got_sha"
	printf '{"kind":"three-ws-db-backup","object":"%s","finished_at":"%s","source":%s,"error":"checksum mismatch after download","ok":false}\n' \
		"$object" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$SRC")" > "$OUT/report.json"
	exit 0
fi

t0=$(date +%s)
tar -xf "$OUT/restore/neondb.tar" -C "$OUT/restore"
mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
gosu postgres initdb -D "$PGDATA" -A trust -U postgres >/dev/null
gosu postgres pg_ctl -D "$PGDATA" -l /workspace/pg.log -o "-c max_wal_size=8GB -c maintenance_work_mem=1GB -c listen_addresses=''" -w start >/dev/null
createdb -h /var/run/postgresql -U postgres neondb
restore_log=/workspace/pg_restore.log
set +e
pg_restore -h /var/run/postgresql -U postgres -d neondb --jobs=8 --no-owner --no-privileges "$OUT/restore/dump" 2> "$restore_log"
restore_exit=$?
set -e
t1=$(date +%s)

q() { psql -h /var/run/postgresql -U postgres -d neondb -XAtqc "$1"; }
restored_tables=$(q "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")
source_tables=$(sed -E 's/.*"source_tables":([0-9]+).*/\1/' "$SRC")
restore_errors=$(grep -c '^pg_restore: error' "$restore_log" || true)

ok=true
[ "$restored_tables" = "$source_tables" ] || ok=false
first=1
checks='{'
for t in $CRITICAL; do
	r=$(q "select count(*) from public.\"$t\"")
	lo=$(sed -E "s/.*\"counts_before_dump\":\\{[^}]*\"$t\":([0-9]+).*/\\1/" "$SRC")
	hi=$(sed -E "s/.*\"counts_after_dump\":\\{[^}]*\"$t\":([0-9]+).*/\\1/" "$SRC")
	[ "$lo" -le "$hi" ] || { tmp=$lo; lo=$hi; hi=$tmp; }
	pass=true
	if [ "$r" -lt "$lo" ] || [ "$r" -gt "$hi" ]; then pass=false; ok=false; fi
	[ $first -eq 1 ] || checks="$checks,"
	checks="$checks\"$t\":{\"restored\":$r,\"source_before\":$lo,\"source_after\":$hi,\"pass\":$pass}"
	first=0
done
checks="$checks}"
[ "$restore_errors" = "0" ] || ok=false
[ "$restore_exit" = "0" ] || ok=false
restore_seconds=$((t1 - t0))

cat > "$OUT/report.json" <<JSON
{"kind":"three-ws-db-backup","object":"$object","finished_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","source":$(cat "$SRC"),"upload_seconds":$upload_seconds,"download_seconds":$download_seconds,"restore_seconds":$restore_seconds,"measured_rto_seconds":$((download_seconds + restore_seconds)),"pg_restore_exit":$restore_exit,"pg_restore_errors":$restore_errors,"restored_tables":$restored_tables,"row_checks":$checks,"ok":$ok}
JSON
cat "$OUT/report.json"
if [ "$ok" != "true" ]; then
	echo "restore verification failed; pg_restore log tail:"
	tail -40 "$restore_log"
fi
