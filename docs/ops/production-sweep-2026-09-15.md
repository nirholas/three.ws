# Production sweep — 2026-09-15

Internal operations record for the NVIDIA follow-up, credential validation,
repository build, and Google Cloud production sweep performed on 2026-09-15.
This document deliberately records outcomes and secret locations, never secret
values.

## NVIDIA response

- The NVIDIA reply is transcribed and actioned in
  [`nvidia-inception-response-2026-09-14.md`](nvidia-inception-response-2026-09-14.md).
- The public-facing catalog and application copy live in
  [`../nvidia-apps-catalog-listing.md`](../nvidia-apps-catalog-listing.md),
  [`../nvidia-apps-catalog-request.md`](../nvidia-apps-catalog-request.md), and
  [`../nvidia-inception.md`](../nvidia-inception.md).
- The source screenshot remains evidence only. It is not published by the docs
  build, and this `docs/ops/` record is also excluded from the public docs bundle.

## Credential handling and authentication

The credentials supplied during the incident were used only in ephemeral,
non-echoing processes. None were written to the repository, Git remotes, npm
configuration, shell profiles, or this document.

| System | Verification result | Durable production location |
| --- | --- | --- |
| GitHub | Both supplied tokens authenticated as `nirholas` | Not stored locally |
| npm | Token authenticated as `nirholas` | Not stored locally |
| Cloudflare API | Token active | Not stored locally |
| Cloudflare R2 | Supplied keypair exactly matches the production pair | `S3_SECRET_ACCESS_KEY` is a Secret Manager reference; non-secret storage settings remain Cloud Run environment values |
| Google Cloud | CLI authenticated; project and region resolved successfully | Existing gcloud configuration |

`npm run check:secrets` found no credential material in tracked or changed
repository files. Because the values were nevertheless pasted into a chat, they
must be treated as disclosed and rotated after this work is complete.

## Production findings

The deep sweep covered public health, version identity, TLS, all Cloud Run
services, schedulers, recent application errors, and the live NVIDIA page.

| Area | Evidence | Classification / action |
| --- | --- | --- |
| Site and TLS | `/api/healthz`, `/api/version`, and `/nvidia` returned `200`; TLS 1.3 negotiated successfully | Healthy. The first probe's timeouts were transient from the probe environment. |
| Cloud Run fleet | All 47 services reported Ready | Healthy |
| Schedulers | All 117 jobs matched the repository schedule and had recent successful liveness | Healthy |
| Object storage / Forge upload | Health reported signed object access; a valid `POST /api/forge-upload` returned `200` and a short-lived presigned PUT | Healthy. The earlier 503 samples were not reproducible; no credential rotation was needed. |
| Pump curve | Identical live calls split between fast `502` responses and correct responses depending on the Cloud Run instance | Code defect fixed: the outer RPC wrapper now forces a recovery probe when stale cooldown state excludes every lane. |
| Cryptocurrency narrative service | `/api/narratives` continues to return `503`. Production requests the unavailable Groq model `llama-3.3-70b-versatile`, which the provider rejects with `model_not_found`. Its separate Cloud Run service also logs repeated facilitator discovery failures because `x402.sperax.io` currently resolves to a missing Railway application (`404 Application not found`). | External-service / separate-repository issue. Select a model available to the production Groq account, restore the Sperax facilitator deployment, and then redeploy and verify `cryptocurrency-cv`. Do not point production at an incompatible facilitator or silently disable paid routes. |
| CoinCommunities integration | `/api/clash/state` intentionally returns `503` while its production credential is absent | Owner configuration required |
| watsonx integration | `/api/galaxy` intentionally returns `503` while watsonx credentials are absent | Owner configuration required |
| x402 settlement | Health showed the sponsor fee wallet below its configured floor; the treasury-topup scheduler is enabled every 30 minutes. A non-mutating dry-run confirmed that there is nothing reclaimable and no spare USDC for the revenue-funded refill path. | Owner funding required for the economy master wallet. Never lower the floor or fund per-agent wallets directly. |

Database, wallet, and custodial deep checks that require local secret material
were skipped by the generic sweep; the deployed health endpoint and scheduler
checks still covered their public operational signals.

## Repository fixes

- `fix(chat): declare noble hashes dependency` — the chat bundle imported
  `@noble/hashes/sha3` without declaring the package, making builds depend on an
  accidental root-level hoist.
- `fix(solana): probe RPC recovery after full cooldown` — prevents warm
  instances from returning an immediate pump-curve outage solely because every
  endpoint is marked cooling. A regression test pins the forced recovery pass.

## Safe follow-up

1. Rotate all credentials disclosed in chat, then update only their proper
   secret stores. Do not put replacement values in Git.
2. Fund the economy master wallet sufficiently for the existing treasury-topup
   job to refill the under-floor targets. Do not bypass the master wallet or
   lower the configured floor.
3. Replace the unavailable Groq model in `cryptocurrency-cv`, restore the
   external `x402.sperax.io` Railway deployment (or deploy the facilitator from
   its own repository with its existing settlement secrets), and verify
   `/health`, `/supported`, and `/api/narratives`.
4. Add the owner-held CoinCommunities and watsonx credentials if those optional
   integrations should be live.
5. Re-run the deep production sweep after those owner actions.
