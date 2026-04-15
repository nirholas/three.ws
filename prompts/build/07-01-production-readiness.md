---
mode: agent
description: "Make the deployment actually observable — error tracking, usage metrics, health checks"
---

# 07-01 · Production readiness

## Why it matters

Right now a 500 on `/api/agents/me` reaches a user's browser, surfaces in the console, and nobody knows it happened until the user complains. The product has real users now; we need a minimum-viable observability pass so regressions are caught in minutes, not weeks. This is cross-cutting infrastructure — not a feature, but it blocks shipping features confidently.

## Prerequisites

None. Can be done anytime after pillar 1 ships.

## Read these first

- [api/_lib/http.js](../../api/_lib/http.js) — `wrap()` catches all unhandled errors. Extend it.
- [api/_lib/env.js](../../api/_lib/env.js) — env var access pattern.
- [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js) — Upstash Redis already a dep.

## Build this

### 1. Error reporting

- Add Sentry (or a simpler equivalent like Axiom / Logtail) as the error sink. Sentry is the conservative choice — the `@sentry/node` SDK works in Vercel functions.
- Initialize at the top of [api/_lib/http.js](../../api/_lib/http.js)'s `wrap` helper.
- Tag events with: `endpoint` (req.url), `user_id` (if session), `release` (git sha at build time).
- Env: `SENTRY_DSN`. If unset, log to stderr and no-op on network — do not crash.

### 2. Client-side error reporting

- Add `@sentry/browser` (or manual `navigator.sendBeacon` to a `/api/client-error` endpoint) that captures uncaught errors on the agent page, dashboard, and auth pages.
- Strip message content for privacy; report only stack + URL + user agent.
- Disable in localhost.

### 3. Health check endpoint

- `GET /api/health` returns `{ ok: true, checks: { db, r2, redis } }` with per-service status.
- Each check is a fast probe: `SELECT 1`, `HEAD` on R2, `PING` on Upstash.
- Timeout each probe at 2s so a slow dependency doesn't hang the whole check.
- Status code: 200 if all OK, 503 if any fail.

### 4. Request metrics

- In `wrap()`, log per-request: method, path, status, duration_ms, user_id.
- Write to Upstash Redis as a sliding counter keyed by `metrics:<endpoint>:<day>`.
- Expose read-only at `GET /api/admin/metrics` (admin-scoped — check for a specific user id or API key).

### 5. Deploy script

- Add a `scripts/deploy-check.sh` that:
  1. Runs `npm run build`.
  2. POSTs to `/api/health` on the current Vercel preview URL — fails if not 200.
  3. Runs `scripts/smoke-stack.sh` (from prompt `00-stack-e2e-smoke.md`).
  4. Only on green, prints the promote-to-prod command.

Do not auto-promote. Deploys are still manual.

### 6. Status page

- A minimal static `public/status.html` that polls `/api/health` every 30s and shows green/red for each service.
- Linked from the dashboard footer for logged-in users.

## Out of scope

- APM / distributed tracing (Sentry's basic tracing is good enough for v1).
- Alerting rules — configure in the Sentry / Upstash dashboards, not code.
- Log aggregation beyond Sentry.
- Uptime monitoring external to Vercel (future).

## Acceptance

1. `GET /api/health` returns 200 with all green when services are up.
2. Stopping Upstash locally (or revoking the token) flips the `redis` check to red, endpoint returns 503.
3. A deliberate throw in any endpoint produces a Sentry event tagged with `endpoint` and `user_id`.
4. `scripts/deploy-check.sh` succeeds on a healthy preview URL.
5. `/status.html` shows per-service state and auto-refreshes.
6. No PII is sent to Sentry (inspect an event — no email, no message body, no wallet address).

## Report

- Paste a Sentry event URL demonstrating an error captured from a failing endpoint.
- Paste `/api/health` output.
