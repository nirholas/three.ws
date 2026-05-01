# Fix: zauth SDK missing from Vercel lambda bundle → 503 on /api/chat

## Symptom

Vercel production logs show this error on cold starts for `/api/chat`, `/api/chat/models`,
`/api/chat/config`, and `/api/agent-actions`:

```
[zauth] failed to build middleware: Cannot find module '/var/task/node_modules/@zauthx402/sdk/dist/middleware/index.js'
```

`/api/chat` returns **503**. All other zauth-instrumented routes lose monitoring silently.

## Root cause

`api/_lib/zauth.js` imports from `@zauthx402/sdk` (the package main entry). At runtime the
SDK internally tries to load `dist/middleware/index.js`. Vercel's `@vercel/nft` static tracer
misses this file because of the conditional exports `import`/`require` split in the SDK's
`package.json` — so `dist/middleware/index.js` is never bundled into `/var/task`.

The SDK's `package.json` exports map:
```json
{
  ".": {
    "import": "./dist/index.mjs",
    "require": "./dist/index.js"
  },
  "./middleware": {
    "import": "./dist/middleware/index.mjs",
    "require": "./dist/middleware/index.js"
  }
}
```

`@vercel/nft` traces `dist/index.mjs` (the `import` condition) but doesn't pick up
`dist/middleware/index.js` (the CJS `require` condition). At runtime Node resolves the
`require` path and crashes.

## Fix

Add a `functions` block to `vercel.json` that force-bundles the entire SDK `dist/` directory
for all API routes. This bypasses nft's static analysis for this package.

### `vercel.json`

Add the following block at the top level, before `"routes"`:

```json
"functions": {
  "api/**/*.js": {
    "includeFiles": "node_modules/@zauthx402/sdk/dist/**"
  }
},
```

**Why `api/**/*.js`:** Every API route uses `wrap()` from `api/_lib/http.js`, which imports
`api/_lib/zauth.js`. The glob covers all current and future route files.

**Why `dist/**`:** The SDK may require multiple files from `dist/` at runtime
(CJS entry, middleware module, source maps). Bundling all of `dist/` is cheaper than
enumerating individual files and won't break if the SDK adds new internal modules.

## Files to edit

- `vercel.json` — add the `functions` block as described above

## Verification checklist

Before opening a PR, confirm:

- [ ] `vercel.json` is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))" && echo ok`
- [ ] The `functions` key appears once, at the root level of the JSON object
- [ ] The glob pattern is exactly `"api/**/*.js"` (double-star, forward slash, no leading slash)
- [ ] The `includeFiles` value is exactly `"node_modules/@zauthx402/sdk/dist/**"`

After deploying to Vercel:

- [ ] Cold-start log shows `[zauth] middleware initialized, key prefix: zauth_…` (not an error)
- [ ] The `[zauth] failed to build middleware:` line is absent from logs
- [ ] `curl -X POST https://three.ws/api/chat -H "content-type: application/json" -d '{"message":"hi","history":[]}' -I` returns `200` or `401`, not `503`
- [ ] `/api/chat/config` returns `200`, not `503`

## Constraints

- Do not disable zauth (do not remove or unset `ZAUTH_API_KEY`).
- Do not change any logic in `api/_lib/zauth.js` — only the bundling config.
- Do not add a new npm dependency.
- The `try/catch` in `buildMiddleware()` in `api/_lib/zauth.js` must remain intact.
