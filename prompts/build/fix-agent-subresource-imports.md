---
mode: agent
description: 'Fix broken dynamic import paths in api/agents/[id].js — _sub.js and other sub-handlers not found'
---

# Fix: agent sub-resource handlers not found in production

## Problem

Requests to any agent sub-resource endpoint — `/api/agents/:id/manifest`, `/api/agents/:id/actions`, `/api/agents/:id/embed-policy`, `/api/agents/:id/sign`, `/api/agents/:id/usage`, `/api/agents/:id/animations`, `/api/agents/:id/memories`, `/api/agents/:id/livekit-token`, `/api/agents/:id/embed`, `/api/agents/:id/voice` — all crash in production with:

```
{"error":"ERR_MODULE_NOT_FOUND","error_description":"Cannot find module '/var/task/api/agents/_sub.js' imported from /var/task/api/agents/[id].js"}
```

## Root cause

`api/agents/[id].js` lives at the root of `api/agents/`. It has dynamic imports like:

```js
const mod = await import('./_sub.js');         // WRONG
const mod = await import('./livekit-token.js'); // WRONG
const mod = await import('./embed.js');         // WRONG
const mod = await import('./voice.js');         // WRONG
const mod = await import('./memory/pin.js');    // WRONG
const mod = await import('./memory/[cid].js'); // WRONG
```

These resolve to `api/agents/_sub.js` — a path that does not exist. The actual files are in the `api/agents/_id/` subdirectory:

```
api/agents/_id/_sub.js
api/agents/_id/embed.js
api/agents/_id/livekit-token.js
api/agents/_id/voice.js
api/agents/_id/memory/pin.js
api/agents/_id/memory/[cid].js
```

The two imports that ARE correct (they resolve to sibling files at `api/agents/`):
```js
const mod = await import('./solana-wallet.js');  // correct — file is api/agents/solana-wallet.js
const mod = await import('./sns.js');            // correct — file is api/agents/sns.js
```

## What to do

In `api/agents/[id].js`, change every broken dynamic import to use the `_id/` prefix:

| Current | Correct |
|---|---|
| `import('./_sub.js')` | `import('./_id/_sub.js')` |
| `import('./livekit-token.js')` | `import('./_id/livekit-token.js')` |
| `import('./embed.js')` | `import('./_id/embed.js')` |
| `import('./voice.js')` | `import('./_id/voice.js')` |
| `import('./memory/pin.js')` | `import('./_id/memory/pin.js')` |
| `import('./memory/[cid].js')` | `import('./_id/memory/[cid].js')` |

Do NOT change:
- `import('./solana-wallet.js')` — correct already
- `import('./sns.js')` — correct already
- Any imports in `api/agents/_id/*.js` themselves — those are fine

## Verify locally

```bash
node -e "import('./api/agents/[id].js').then(() => console.log('OK')).catch(e => console.error(e.message))"
# Must print: OK
```

Also confirm the sub-module loads:
```bash
node -e "import('./api/agents/_id/_sub.js').then(m => console.log('_sub exports:', Object.keys(m)))"
```

## Files to change

- `api/agents/[id].js` — only this file; do not touch anything in `api/agents/_id/`

## Acceptance

- `node -e "import('./api/agents/[id].js').then(() => console.log('OK'))"` exits cleanly
- After deploying, `curl https://three.ws/api/agents/{any-valid-agent-id}/manifest` returns JSON, not 500
- No `ERR_MODULE_NOT_FOUND` errors in Vercel logs for agent sub-resource paths

## Out of scope

- Do not refactor `[id].js` — only fix the import paths
- Do not rename or move files in `api/agents/_id/`
