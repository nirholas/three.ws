# Fix: `embed.js` sends Anthropic API key to VoyageAI

## What is broken

`POST /api/agents/:id/embed` returns a 502 in production. The endpoint generates
text embeddings via VoyageAI but authenticates using `env.ANTHROPIC_API_KEY`, which
is an Anthropic key — a completely separate company. VoyageAI rejects it with a 401,
the handler logs the error and returns `{ error: "upstream_error" }`.

## Root cause

File: `api/agents/_id/embed.js` (if the `[id]→_id` rename has been done) or
`api/agents/[id]/embed.js` (if not yet renamed).

Line ~32–36:

```js
const upstream = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.ANTHROPIC_API_KEY}`,   // ← WRONG KEY
    },
    body: JSON.stringify({ ... }),
});
```

VoyageAI (`api.voyageai.com`) requires its own API key, not the Anthropic key.

## Fix

### Step 1 — add `VOYAGE_API_KEY` to `api/_lib/env.js`

Open `api/_lib/env.js`. Find where other optional API keys are defined (e.g. near
`ELEVENLABS_API_KEY` or `ANTHROPIC_API_KEY`). Add:

```js
get VOYAGE_API_KEY() {
    return req('VOYAGE_API_KEY');
},
```

Use `req()` (not `opt()`) because this endpoint is non-functional without the key —
failing fast at startup is better than a runtime 502.

If the project already has an `opt()` version for graceful degradation, that's also
acceptable, but the handler must then return a 503 when the key is absent (see Step 2).

### Step 2 — update `embed.js` to use the correct key

In `api/agents/_id/embed.js` (or `api/agents/[id]/embed.js` if not yet renamed),
replace the authorization header:

```js
// Before
authorization: `Bearer ${env.ANTHROPIC_API_KEY}`,

// After
authorization: `Bearer ${env.VOYAGE_API_KEY}`,
```

If you used `opt()` in Step 1, add an early guard before the upstream fetch:

```js
const voyageKey = env.VOYAGE_API_KEY;
if (!voyageKey) return error(res, 503, 'not_configured', 'embedding service is not configured');
```

And then use `voyageKey` instead of `env.VOYAGE_API_KEY` in the fetch header so
you're not calling the getter twice.

### Step 3 — add the env var to Vercel

In the Vercel project dashboard → Settings → Environment Variables, add:

```
VOYAGE_API_KEY = <your VoyageAI key>
```

This must be set in production (and preview if used there). The key is obtained from
https://dash.voyageai.com — create one under API Keys.

Do NOT commit the actual key value to the repo. Only add it to Vercel's env var store.

## Verify

1. After deploying, `POST /api/agents/:id/embed` with `{ "text": "hello world" }` and a
   valid auth session should return `{ "embedding": [...1024 numbers...] }`.
2. The response must be a real 1024-dimensional float array from VoyageAI — not mocked,
   not a stub, not a hardcoded array.
3. Confirm the old `env.ANTHROPIC_API_KEY` reference is gone from `embed.js`:
   `grep "ANTHROPIC_API_KEY" api/agents/_id/embed.js` should return nothing.

## Constraints

- Do not change the VoyageAI model (`voyage-3-lite`), input type (`query`), or the
  response shape (`{ embedding: number[] }`).
- Do not change the request/response shape of the endpoint itself.
- The `ANTHROPIC_API_KEY` is still used elsewhere (LLM calls, etc.) — only remove it
  from `embed.js`. Do not touch any other file that imports it.
- No mocking, no fake embeddings. The fix must result in real VoyageAI calls.
