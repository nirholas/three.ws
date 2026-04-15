# 05-07 — Referrer allowlist enforcement at the edge

## Why it matters

The `origin_allowlist` in embed policy (05-05) is meaningless if the embed HTML is served to anyone who asks for it. A malicious host can strip our runtime checks. Enforcement has to happen server-side on the embed route — before any JS loads — so blocked hosts get an explicit `403` response, not a blank rectangle.

## Context

- Embed page: [public/agent/embed.html](../../public/agent/embed.html).
- Embed policy table: `agent_embed_policies` (from 05-05).
- Vercel route map: [vercel.json](../../vercel.json).
- Existing scaffolding: [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html).

## What to build

### Server-side embed handler — `api/agents/[id]/embed.js`

Reroute `/a/:id/embed` through a serverless function that:

1. Loads the agent's `agent_embed_policies` row.
2. If `require_referrer = true`:
   - Extract `Referer` header (fall back to `Origin` / `Sec-Fetch-Site` for stricter browsers).
   - If the request is top-level (Sec-Fetch-Site: `none`) and `require_referrer` is true → allow only if the policy explicitly whitelists `*` or the page's own origin.
   - Match the referrer origin against `origin_allowlist`. Support glob entries like `https://*.lobehub.com`.
3. On match → serve the existing static [public/agent/embed.html](../../public/agent/embed.html) with:
   - `Content-Security-Policy: frame-ancestors <joined-allowlist>;`
   - `X-Frame-Options` omitted intentionally (CSP is authoritative and CSP `frame-ancestors` deprecates XFO).
   - `X-Robots-Tag: noindex`.
4. On miss → `403` with a styled explainer page (HTML) that names the expected allowlist and a "Contact agent owner" mailto. Do not leak the full allowlist; show only the requested origin.

### Vercel rewrite

Update [vercel.json](../../vercel.json) so `/a/:id/embed` hits the new function while `/a/:id` continues to serve the static agent page.

### Headers audit

Every agent embed response must include:

- `Content-Security-Policy: frame-ancestors …` (dynamic per agent).
- `Permissions-Policy: microphone=(), camera=()` by default. Flip to `self` only if the policy has `listen` capability (05-05).
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
- `Cross-Origin-Embedder-Policy: credentialless` (needed for glTF CORS in Claude Artifacts).
- `Cache-Control: private, no-store` on the policy-gated response (to prevent a CDN from caching a permissive response and serving it across origins).

### Dashboard feedback

On [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html), add a "Test embed" panel that:

- Takes a URL to test.
- Fetches `/a/:id/embed` with `Referer` spoofed (server-side; or a dedicated `/api/agents/:id/embed/test?referrer=…` diagnostic endpoint).
- Reports PASS/FAIL with the matched allowlist entry.

## Out of scope

- DRM or token-gating (that's paid plans).
- Per-visitor tracking.
- Rewriting the static page to be a server component.

## Acceptance

1. Embed with `Referer: https://allowed.example` (in allowlist) → 200, avatar renders.
2. Embed with `Referer: https://evil.example` → 403, explainer page.
3. Curl with no `Referer` and `Sec-Fetch-Site: cross-site` → 403.
4. Response headers include the CSP frame-ancestors list and Permissions-Policy.
5. Setting `require_referrer = false` allows any referrer but keeps the other headers.
6. `node --check` passes on new files.
