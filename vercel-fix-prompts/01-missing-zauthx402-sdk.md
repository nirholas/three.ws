# Fix: Missing @zauthx402/sdk Module in Vercel Deployment

## Problem

Vercel logs show 837+ instances of this error across nearly every API endpoint:

```
[zauth] failed to load @zauthx402/sdk: Cannot find module '/var/task/node_modules/@zauthx402/sdk/dist/middleware/index.js'
```

This prevents the zauth authentication middleware from loading, causing 401/402/403 responses on:
- `/api/agents/[id]`
- `/api/auth/*`
- `/api/mcp`
- `/api/widgets`
- `/api/agent-actions`
- `/api/agents/pumpfun`
- and many more

## What to investigate

1. Check if `@zauthx402/sdk` is listed as a dependency in `package.json` — it may be missing or listed under `devDependencies` instead of `dependencies`.
2. Check if there is a `.npmrc`, `.vercelignore`, or custom install script that might exclude it from the Vercel build.
3. Check `vercel.json` for any `includeFiles` or build config that might be stripping node_modules.
4. Confirm the import path used in the zauth middleware matches the actual export path in `@zauthx402/sdk/dist/middleware/index.js`.
5. If the package is a private/internal package, confirm it is accessible during Vercel's build step (correct npm token configured).

## Expected fix

- `@zauthx402/sdk` must appear in `dependencies` (not `devDependencies`) in `package.json`.
- After fixing, redeploy and confirm the error no longer appears in Vercel function logs.
- All auth-protected endpoints should return proper 200/401 responses instead of failing at middleware load time.
