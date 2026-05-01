---
mode: agent
description: 'Fix vercel.json route ordering so /api/agents/x402/* hits the x402 handler, not the generic agent sub-resource handler'
---

# Fix: /api/agents/x402/* routes to wrong handler

## Problem

`/api/agents/x402/invoke` and `/api/agents/x402/manifest` are x402 payment endpoints that should route to `api/agents/x402/[action].js`. Instead they route to `api/agents/[id].js` with `id = "x402"`, which then tries to look up agent UUID `x402` in the database — returns 404 or runs the wrong handler.

## Root cause

In `vercel.json`, the generic sub-resource rules appear **before** the x402-specific rules:

```json
{ "src": "/api/agents/([^/]+)/manifest", "dest": "/api/agents/[id]" },   // line ~98 — catches x402/manifest first
{ "src": "/api/agents/([^/]+)/actions", "dest": "/api/agents/[id]" },

... many more generic rules ...

{ "src": "/api/agents/x402/invoke",   "dest": "/api/agents/x402/[action]?action=invoke" },   // line ~114 — never reached
{ "src": "/api/agents/x402/manifest", "dest": "/api/agents/x402/[action]?action=manifest" }, // line ~115 — never reached
```

Vercel evaluates routes top-to-bottom and stops at first match. `/api/agents/([^/]+)/manifest` matches `/api/agents/x402/manifest` before the x402-specific rule runs.

## What to do

Move the two x402-specific rules to **before** the generic `/api/agents/([^/]+)/...` block in `vercel.json`.

Find this block (the first generic agent sub-resource rule in the file):

```json
{ "src": "/api/agents/([^/]+)/wallet", "dest": "/api/agents/[id]" },
```

Insert the x402 rules immediately before it:

```json
{ "src": "/api/agents/x402/invoke",   "dest": "/api/agents/x402/[action]?action=invoke" },
{ "src": "/api/agents/x402/manifest", "dest": "/api/agents/x402/[action]?action=manifest" },
{ "src": "/api/agents/([^/]+)/wallet", "dest": "/api/agents/[id]" },
```

Then remove the duplicate x402 rules that currently appear later in the file.

Apply the same principle to any other literal-path x402 rules that exist (check for other `/api/agents/x402/` entries that could be shadowed).

## Verify

Read `vercel.json` after the change. Confirm:
1. The x402 rules appear before `/api/agents/([^/]+)/wallet`
2. There are no duplicate x402 entries later in the file
3. JSON is valid: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"`

## Test after deploy

```bash
# Should return JSON with x402 payment requirements for an agent, not 404
curl -s https://three.ws/api/agents/x402/manifest | jq .

# Should return 402 payment required (not 404 agent not found)
curl -i https://three.ws/api/agents/x402/invoke -X POST -H "content-type: application/json" -d '{}'
```

## Files to change

- `vercel.json` — only route ordering; no logic changes

## Acceptance

- `curl https://three.ws/api/agents/x402/manifest` returns the x402 manifest JSON (not 404)
- `curl -X POST https://three.ws/api/agents/x402/invoke` returns 400 (missing params) or 402, not 404
- No regressions on `/api/agents/:id/manifest` for real agent UUIDs

## Out of scope

- Do not change `api/agents/x402/[action].js`
- Do not change `api/agents/[id].js`
- Only reorder routes — do not add, remove, or modify route destinations
