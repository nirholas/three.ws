#!/bin/bash
# Boot script for the three-ws-redis VM (Container-Optimized OS) in project three-ws.
#
# Runs Redis 7 plus serverless-redis-http (SRH), the REST proxy that speaks the
# @upstash/redis dialect the app already uses, so three-ws-api reaches it with
# UPSTASH_REDIS_REST_URL=http://10.128.0.50 over the three-ws-vpc connector.
# Same shape as the old project's Memorystore + SRH stack, on one small VM.
# Runbook: deploy/redis-vm/README.md.
set -euo pipefail

DATA=/mnt/stateful_partition/redis-data
mkdir -p "$DATA"

# SRH bearer token from Secret Manager (srh-proxy-token), read with the VM's own
# service account through the metadata server.
TOKEN_URL="http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
PROJECT=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/project-id)
ACCESS=$(curl -s -H "Metadata-Flavor: Google" "$TOKEN_URL" | sed -n -E 's/.*"access_token":"([^"]+)".*/\1/p')
SRH_TOKEN=$(curl -s -H "Authorization: Bearer $ACCESS" \
	"https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/srh-proxy-token/versions/latest:access" \
	| sed -n -E 's/.*"data": *"([^"]+)".*/\1/p' | base64 -d)
if [ -z "$SRH_TOKEN" ]; then
	echo "redis-vm: could not read srh-proxy-token from Secret Manager" >&2
	exit 1
fi

docker network inspect redis-net >/dev/null 2>&1 || docker network create redis-net

docker rm -f redis srh >/dev/null 2>&1 || true

# volatile-lru matches the Memorystore basic-tier default the app was tuned on.
docker run -d --name redis --network redis-net --restart always \
	-v "$DATA":/data \
	redis:7.0-alpine \
	redis-server --appendonly yes --maxmemory 1200mb --maxmemory-policy volatile-lru

docker run -d --name srh --network redis-net --restart always \
	-p 80:80 \
	-e SRH_MODE=env \
	-e SRH_TOKEN="$SRH_TOKEN" \
	-e SRH_CONNECTION_STRING=redis://redis:6379 \
	hiett/serverless-redis-http:0.0.10
