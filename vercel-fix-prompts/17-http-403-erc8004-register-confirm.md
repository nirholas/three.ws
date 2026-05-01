# Fix: HTTP 403 from Upstream on /api/erc8004/register-confirm

## Problem

`/api/erc8004/register-confirm` returns 500 due to:

```
[api] unhandled Error: HTTP 403
```

The handler makes an external HTTP request that is returning 403 Forbidden from the upstream service. This unhandled error propagates as a 500 to the client.

## What to investigate

1. Find the handler for `/api/erc8004/register-confirm`.
2. Identify the external URL it calls (the one returning 403).
3. Determine why the upstream is returning 403 — common causes:
   - Missing or expired API key in request headers.
   - API key environment variable not set in Vercel production environment.
   - IP allowlist on the upstream service that doesn't include Vercel's IPs.
   - Request is missing a required authentication header or signature.
4. Check if the API key / credentials for this service are configured in Vercel environment variables.

## Expected fix

**If it's a missing/expired API key:**
- Obtain a valid API key for the ERC8004 registration service.
- Add it as a Vercel environment variable (e.g. `ERC8004_API_KEY`).
- Update the handler to include it in the request headers.

**For the unhandled error (immediate fix):**
Regardless of the upstream cause, wrap the external call so it returns a proper error response instead of a 500:

```js
const response = await fetch(upstreamUrl, { headers: { ... } });
if (response.status === 403) {
  return res.status(502).json({ error: 'Registration service rejected the request' });
}
if (!response.ok) {
  return res.status(502).json({ error: `Upstream error: ${response.status}` });
}
```
