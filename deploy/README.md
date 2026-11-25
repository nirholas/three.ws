# deploy/

Build and deploy configuration for auxiliary Cloud Run services that run outside the main `three-ws-api` container. Each target has its own directory with the config and a runbook. The main API and frontend deploy is documented in [docs/ops/gcp-production.md](../docs/ops/gcp-production.md) instead.

| Target | Description |
| --- | --- |
| [db-backup](db-backup/README.md) | Daily Cloud Scheduler plus Cloud Build run that dumps the production Neon database to a retention-locked GCS bucket and restore-tests every archive into a throwaway PostgreSQL, publishing the measured RTO. |
| [insta360](insta360/README.md) | The verified worker digests that `npm run ship:insta360` deploys: the 360 capture GPU workers (`model-pano2splat`, `model-panodepth`) on L4 with scale-to-zero, the `model-video2motion` image roll, the `three-ws-api` env wiring and one production preview job per lane. |
| [redis-vm](redis-vm/README.md) | The self-hosted Redis VM (Redis 7 behind the serverless-redis-http REST proxy) that `three-ws-api` reaches over the `three-ws-vpc` connector in project `three-ws`; boot script, create command and checks. |
| [sniper](sniper/README.md) | Deploys the always-on `agent-sniper` worker to Cloud Run: it holds the live PumpPortal new-mint feed open, scores launches against armed strategies, and in live mode snipes from each agent's own encrypted wallet. |
| [world](world/README.md) | Deploys world.three.ws, a Hyperfy multiplayer 3D world server pinned to an exact upstream commit with local patches; runs as its own Cloud Run service with all state in the `world-three-ws-data` GCS bucket. |
