# Fix: Missing _sub.js Internal Module in Deployment

## Problem

2,892 instances of this error causing 500 on `/api/agents/[id]`:

```
[api] unhandled Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/api/agents/_sub.js'
imported from /var/task/api/agents/[id].js
```

The deployed bundle is missing `api/agents/_sub.js` which is imported by `api/agents/[id].js`.

## What to investigate

1. Confirm `api/agents/_sub.js` (or `_sub.ts`) exists in the repo.
2. Check if the file is excluded from the Vercel deployment by `.vercelignore` or build config. Files prefixed with `_` may be intentionally excluded by some frameworks (e.g. Next.js excludes `_` prefixed pages from routing but should still include them as modules).
3. Check `vercel.json` for any `includeFiles` rules that might be too restrictive.
4. In Next.js: files starting with `_` inside `pages/api/` are not treated as routes but they should still be bundled if imported. Confirm the import path is correct relative to `[id].js`.

## Expected fix

- If the file exists but is excluded: update `.vercelignore` or build config to include it.
- If the import path is wrong: fix the relative import in `api/agents/[id].js`.
- If the file is missing entirely: create `api/agents/_sub.js` with the exports that `[id].js` expects.
- Redeploy and confirm `/api/agents/[id]` no longer returns `ERR_MODULE_NOT_FOUND`.
