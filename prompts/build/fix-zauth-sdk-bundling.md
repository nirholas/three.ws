---
mode: agent
description: 'Fix @zauthx402/sdk not bundling in Vercel production — Cannot find module dist/middleware/index.js'
---

# Fix: zauth SDK module not found in production

## Problem

Every API request on `three.ws` that goes through `wrap()` (which is almost all of them) logs:

```
[zauth] failed to load @zauthx402/sdk: Cannot find module '/var/task/node_modules/@zauthx402/sdk/dist/middleware/index.js'
```

The root cause: `api/_lib/zauth.js` used `createRequire(import.meta.url)` to lazily require `@zauthx402/sdk/middleware`. Vercel's `@vercel/nft` dependency tracer cannot reliably follow dynamic `createRequire` calls, so `dist/middleware/index.js` (the `require`-condition target from the package's `exports` map) is never included in the deployed bundle. The file is missing at `/var/task/node_modules/@zauthx402/sdk/dist/middleware/index.js` at runtime.

## Context

- `api/_lib/zauth.js` — the adapter that wraps the SDK for bare Vercel Node handlers
- `api/_lib/http.js` — calls `instrument(req, res)` inside `wrap()` at line ~119; this is how every endpoint touches zauth
- `@zauthx402/sdk` v0.1.14 is in `dependencies` (not optional); `zauthProvider` is exported from both the main entry and the `/middleware` subpath
- `ZAUTH_API_KEY` env var is set in Vercel production; without it the middleware is a no-op regardless
- Docs: https://www.npmjs.com/package/@zauthx402/sdk — the canonical import is `@zauthx402/sdk/middleware`

## What to do

### 1. Fix `api/_lib/zauth.js`

Replace the `createRequire` lazy-load pattern with a **static ESM import from the main entry** `@zauthx402/sdk`. The `zauthProvider` function is re-exported there (confirmed — it is identical to the subpath export). A static import is reliably traced by NFT and avoids the conditional-exports subpath problem entirely.

The file should:
- Use `import { zauthProvider } from '@zauthx402/sdk'` at the top
- Remove all `createRequire` / `node:module` imports
- Keep the `ZAUTH_API_KEY` guard (if no key, return null — stay a no-op)
- Keep the `shimRequest` / `shimResponse` / `shouldMonitorReq` logic untouched
- Add a `console.log('[zauth] middleware initialized')` in the success branch of `buildMiddleware` so you can confirm in Vercel logs after deploy

### 2. Verify locally

```bash
node -e "import('./api/_lib/zauth.js').then(m => console.log('exports:', Object.keys(m)))"
# Must print: exports: [ 'instrument' ]
```

### 3. Deploy and confirm

After deploying to Vercel:

1. Open Vercel logs, filter by `[zauth]`
2. You should see `[zauth] middleware initialized` on first cold start
3. You should NOT see `[zauth] failed to load` anywhere
4. Run: `curl -i https://three.ws/api/mcp` — should return HTTP 402 (x402 payment required), NOT 500
5. Wait ~30 seconds, check https://zauthx402.com dashboard — Total Calls should increment

## Files to change

- `api/_lib/zauth.js` — only this file

## Acceptance

- No `[zauth] failed to load` errors in Vercel logs after deploy
- `[zauth] middleware initialized` appears in cold-start logs
- `curl https://three.ws/api/mcp` returns 402, not 500
- zauth dashboard shows > 0 calls after hitting the endpoint

## Out of scope

- Do not change `api/_lib/http.js`
- Do not change how `instrument()` is called
- Do not add the `includeFiles` config to `vercel.json` — the import fix makes that unnecessary
