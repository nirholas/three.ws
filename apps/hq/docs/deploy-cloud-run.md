# Deploying HQ to Google Cloud Run

HQ runs on Cloud Run as a single container: the static Vite build (`dist/`) is
served by [`scripts/cloudrun-server.mjs`](../scripts/cloudrun-server.mjs), which
also starts the desktop sidecar API server
(`src-tauri/sidecar/local-api-server.mjs`) on loopback and forwards `/api/*` to
it. All 90+ Vercel-style API routes in `api/` work unchanged. The headers and
rewrites from `vercel.json` (CSP `frame-ancestors`, asset caching, `/intel`)
are reproduced by the server.

Desktop-only management routes (`/api/local-*`, e.g. `local-env-update`) are
blocked with a 404 on the public deployment.

## Target

Deploys are owner-gated: build and test locally, then the owner runs the commands below.

- Project: `aerial-vehicle-466722-p5`
- Region: `us-central1`
- Service: `hq`
- Image repo: `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/hq/hq`

## Health checks

`GET /api/health` reports service status, process vitals, which optional
integrations are configured (booleans only), and reachability of the keyless
upstream data lanes (DeFiLlama, CoinPaprika, Yahoo Finance). Use it for Cloud
Run uptime checks and monitoring. `?probes=0` skips the upstream probes for a
fast liveness-only response.

## Deploy a new version

```bash
TAG=$(git rev-parse --short HEAD)
IMAGE=us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/hq/hq:$TAG

docker build -t $IMAGE .
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
docker push $IMAGE

gcloud run deploy hq \
  --image $IMAGE \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 3 --timeout 60
```

## API keys

The dashboard degrades gracefully without keys. To enable full data coverage,
set the env vars from [`.env.example`](../.env.example) on the service:

```bash
gcloud run services update hq --region us-central1 \
  --set-env-vars GROQ_API_KEY=...,FINNHUB_API_KEY=...,UPSTASH_REDIS_REST_URL=...,UPSTASH_REDIS_REST_TOKEN=...
```

## Custom domain / Cloudflare

To serve behind a Cloudflare-managed domain, add a CNAME in Cloudflare pointing
at the Cloud Run domain mapping (`gcloud beta run domain-mappings create
--service hq --domain <domain> --region us-central1`), or proxy the run.app URL
directly. If the domain will embed HQ in another page, keep that page's origin listed in the CSP
`frame-ancestors` in both `vercel.json` and `scripts/cloudrun-server.mjs`.
