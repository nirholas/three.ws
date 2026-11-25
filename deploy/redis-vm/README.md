# three-ws-redis VM (project `three-ws`)

Self-hosted Redis for the `three-ws-api` Cloud Run service in the `three-ws` project. It replaces the old project's Memorystore stack at about a third of the cost.

The app needs no code changes. It already talks to Redis through the `@upstash/redis` REST dialect, so this VM runs [serverless-redis-http](https://github.com/hiett/serverless-redis-http) (SRH) in front of Redis 7, the same proxy the old stack used.

## Shape

```
three-ws-api (Cloud Run)
  └─ VPC connector three-ws-vpc (10.8.0.0/28), egress private-ranges-only
       └─ UPSTASH_REDIS_REST_URL = http://10.128.0.50
          UPSTASH_REDIS_REST_TOKEN = secret:srh-proxy-token
             │
VM three-ws-redis (e2-small, Container-Optimized OS, no public IP)
  internal IP 10.128.0.50 (reserved address three-ws-redis-ip)
  ├─ srh   (hiett/serverless-redis-http:0.0.10, pinned) on :80
  └─ redis (redis:7.0-alpine, AOF on /mnt/stateful_partition/redis-data,
            maxmemory 1200mb, volatile-lru)
```

Other pieces:

- **Firewall rule `three-ws-allow-connector-to-redis`:** only the connector range (10.8.0.0/28) can reach port 80 on VMs tagged `three-ws-redis`.
- **Cloud NAT `three-ws-nat` on router `three-ws-router`:** gives the VM outbound access to pull images without a public IP.
- **Service account `three-ws-redis-vm@`:** has `secretAccessor` on `srh-proxy-token` only. [startup.sh](startup.sh) reads the token at boot.

Approximate cost: VM about $13/month, connector about $9-12, NAT about $1.

## Create or recreate

```bash
gcloud compute instances create three-ws-redis \
  --project three-ws --zone us-central1-a \
  --machine-type e2-small \
  --image-family cos-stable --image-project cos-cloud \
  --boot-disk-size 20GB --boot-disk-type pd-balanced \
  --subnet default --private-network-ip 10.128.0.50 --no-address \
  --tags three-ws-redis \
  --service-account three-ws-redis-vm@three-ws.iam.gserviceaccount.com \
  --scopes cloud-platform \
  --metadata-from-file startup-script=deploy/redis-vm/startup.sh
```

The startup script runs on every boot. It recreates both containers from the pinned images, and Redis data survives in the AOF file on the stateful partition.

## Check it

From any machine on the VPC (the devbox, for example):

```bash
TOKEN=$(gcloud secrets versions access latest --secret=srh-proxy-token --project three-ws)
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '[["PING"]]' http://10.128.0.50/pipeline        # [{"result":"PONG"}]
```

In production, `/api/healthz` reports the cache backend as `upstash healthy`. The client labels itself "upstash" even though it talks to this VM.

## Retire

Point `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` somewhere else. Then delete the VM, the `three-ws-redis-ip` address, the firewall rule, the NAT and router, and the connector. Before deleting the connector, remove `--vpc-connector` from `server/cloudbuild.yaml`, or the next deploy fails.
