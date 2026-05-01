# Fix: Missing JWT_SECRET Environment Variable

## Problem

Vercel logs show this error on `/api/agents` and `/api/auth/siwe/nonce`:

```
[api] unhandled Error: Missing required env var: JWT_SECRET
```

This causes 500 errors on any endpoint that issues or validates JWTs.

## What to investigate

1. Check all files that reference `JWT_SECRET` — confirm what environment variable name the code expects exactly (case-sensitive).
2. Go to the Vercel project dashboard → Settings → Environment Variables and confirm `JWT_SECRET` is set for the correct environments (Production, Preview, Development).
3. Check if the variable name in the code might differ from what's set in Vercel (e.g. `NEXT_PUBLIC_JWT_SECRET` vs `JWT_SECRET`).
4. Confirm the value is non-empty and correctly formatted (should be a long random secret string, not a placeholder).

## Expected fix

- Add `JWT_SECRET` to Vercel environment variables with a strong random secret value.
- Redeploy after adding the variable.
- `/api/agents` and `/api/auth/siwe/nonce` should no longer return 500 errors due to this missing variable.
