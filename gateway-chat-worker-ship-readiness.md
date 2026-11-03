---
slug: gateway-chat-worker-ship-readiness
title: Chat gateway worker passes a build-verify and a live Telegram round trip, ready to ship in one command
tier: P1
score: 68
area: gateway
sources: workers/agent-gateway/README.md, workers/signal-bridge/README.md, docs/chat-gateways.md
---

## Why this matters

Telegram, Discord and Signal users cannot talk to their three.ws agents because the consumer of `gateway_inbox` is not running. The receivers in `api/gateway/telegram.js` and `api/gateway/discord.js` already accept deliveries and queue them, so every message sent to a connected bot today sits unanswered. The worker is built and unit-tested, but nobody has proven the production image builds, nor driven one real message through it. Shipping becomes a single owner-approved command only once that proof exists.

## Current state (measured by the reviewer on 2026-11-03)

- `workers/agent-gateway/` has Dockerfile, cloudbuild.yaml, `src/`, `scripts/`, and five test files under `workers/agent-gateway/tests/` (drain, telegram-adapter, discord-adapter, approval-buttons, registry-setup). Its README says "built and tested, not deployed".
- `gcloud run services list` (project aerial-vehicle-466722-p5) shows no `agent-gateway` service. `workers/agent-orders/cloudbuild.verify.yaml` is the existing pattern for a build-only proof; the gateway has no equivalent.
- Receivers exist at `api/gateway/telegram.js`, `api/gateway/discord.js`, `api/gateway/connections.js`. Both gateway migrations are reported applied in production.
- `three-ws-api` carries `TELEGRAM_BOT_TOKEN` and no Discord variables, so a deploy today would load the Telegram adapter only.
- `workers/signal-bridge/` (Dockerfile, cloudbuild.yaml, persist.sh) has no tests and no verify config. Signal needs this bridge before the gateway can reach it.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name)' | grep -E 'agent-gateway|signal-bridge' || echo "neither deployed"
ls workers/agent-gateway/cloudbuild.verify.yaml workers/signal-bridge/cloudbuild.verify.yaml 2>&1
(cd workers/agent-gateway && npm ci --dry-run >/dev/null && npx vitest run 2>&1 | tail -15)
npm run db:status 2>&1 | grep -i gateway
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json > "$TMPDIR/api.json" && node workers/agent-gateway/scripts/deploy-env.mjs "$TMPDIR/api.json" --print; rm -f "$TMPDIR/api.json"
```

## Tasks

1. Add `workers/agent-gateway/cloudbuild.verify.yaml` and `workers/agent-gateway/verify.gcloudignore`, copying the structure of `workers/agent-orders/cloudbuild.verify.yaml`: same Dockerfile, repo-root context, pinned `three-ws-build@` service account, stops before push and deploy. Run it with `gcloud builds submit` and record the build id and result in the worker README.
2. Make the image prove itself at build time: add a final `RUN` (or verify step) that imports the worker entry point and the registry in `workers/agent-gateway/src/` and runs `ffmpeg -version`, so a missing system dependency fails the build instead of the first voice note.
3. Add `workers/agent-gateway/tests/healthz.test.js` covering the `/healthz` payload: loaded adapters, `skipped` list with the reason for each skipped platform, and a non-200 when no adapter loads. Test-first: write it against current behavior, confirm which assertions fail, and fix any gap in `src/`.
4. Add an end-to-end drain test against a real Postgres (use the test database approach already used in `workers/agent-gateway/tests/_db.js`): insert a real Telegram `update` row shaped like the production receiver writes it (read `api/gateway/telegram.js` for the exact columns), run one drain cycle with the Telegram API replaced by the existing recorded fixtures in `workers/agent-gateway/tests/fixtures/`, and assert the reply row, the lease release, and exactly-once behavior on a duplicate `update_id`.
5. Write a live smoke script `workers/agent-gateway/scripts/live-smoke.mjs`. It reads `TELEGRAM_BOT_TOKEN` from Secret Manager (`gcloud secrets versions access`), never prints it, calls `getWebhookInfo` and reports URL, `pending_update_count`, `last_error_message`; then reports `select count(*) from gateway_inbox` grouped by status. Run it and record the real numbers in the README Deploy section.
6. Resolve the backlog policy: decide what happens to rows already queued before the worker starts (age them out after a configurable TTL with a polite "sorry, I was offline" reply, or answer them). Implement in `workers/agent-gateway/src/`, with a test for the TTL boundary, and document it.
7. Signal: add `workers/signal-bridge/cloudbuild.verify.yaml`, a smoke test that starts the bridge container's HTTP surface without a real number registered and asserts its health route, and document in `workers/signal-bridge/README.md` the exact `gcloud run deploy` flags (min instances 1, persistent volume path used by `persist.sh`). Run the verify build.
8. Add `npm run gateway:ship-check` to the root `package.json` that runs the worker's vitest suite, the Step 0 deploy-env preview, and prints the exact owner command (`gcloud builds submit --config workers/agent-gateway/cloudbuild.yaml . --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s)`).
9. Update `workers/agent-gateway/README.md` (Deploy status with today's date and the verify build id), `docs/chat-gateways.md` (what users see until the worker runs vs after), `STRUCTURE.md` if a row is missing, and add a `data/changelog.json` entry only if user-visible behavior changed.

## Definition of done

- [ ] Each of the agent-gateway and signal-bridge verify builds has a SUCCESS result, with the build id recorded in the worker README (check with `gcloud builds describe <id> --region us-central1 --format='value(status)'`).
- [ ] `cd workers/agent-gateway && npx vitest run` passes with the new `healthz` and end-to-end drain tests included.
- [ ] `npm run gateway:ship-check` exits 0 and prints the single ship command.
- [ ] `node workers/agent-gateway/scripts/live-smoke.mjs` prints webhook info and inbox counts without printing any token (grep the output for the token prefix returns nothing).
- [ ] README Deploy section states the real verify build id and date; no "built, not deployed" line is left unqualified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Local docker cannot build the image (3000+ packages, memory) | Use the Cloud Build verify config; never rely on a local docker build |
| Unpinned `gcloud builds submit` fails with "Unknown service account" | Pin `three-ws-build@aerial-vehicle-466722-p5.iam.gserviceaccount.com` in the config, as agent-orders does |
| No Discord variables on three-ws-api | Out of scope to invent them: the worker loads Telegram only and lists Discord under `skipped`; document that and keep going |
| No test Postgres reachable | Use the same approach `tests/_db.js` already uses; if it needs a database URL, take it from the self-unblock playbook database row |

## Gates

The actual `gcloud run deploy` of agent-gateway and signal-bridge is the routine owner production-deploy gate; prepare everything and report the one command. Registering a Signal number or sending a message from a real user account is external posting: do not do it.
