# 16 — LobeHub plugin manifest + config endpoint

## Why

To be installable from LobeHub's marketplace, we need a well-known plugin manifest and a config endpoint. This doesn't yet exist in-repo.

## Parallel-safety

New static file + new endpoint. No edits to anything existing.

## Files you own

- Create: `public/.well-known/lobehub-plugin.json`
- Create: `api/lobehub/config.js`
- Create: `api/lobehub/manifest.js` (dynamic variant of the static file — if LobeHub allows one, prefer static; keep dynamic as a fallback)

## Read first

- Skim the existing well-known files under `public/.well-known/` for conventions.
- [api/_lib/http.js](../../api/_lib/http.js) — `wrap`, `json`, `cors`.

## Deliverable

### `public/.well-known/lobehub-plugin.json`

```json
{
    "$schema": "https://lobehub.com/schema/plugin.json",
    "api": [],
    "identifier": "3d-agent",
    "meta": {
        "title": "3D Agent",
        "description": "Embed any on-chain or off-chain 3D agent as an embodied avatar inside your chat.",
        "avatar": "https://3dagent.vercel.app/favicon.png",
        "tags": ["3d", "avatar", "embodied-agent", "erc-8004"]
    },
    "ui": {
        "mode": "iframe",
        "url": "https://3dagent.vercel.app/agent-embed.html",
        "height": 640,
        "settings": {
            "agentId": {
                "type": "string",
                "title": "Agent ID",
                "description": "Paste a 3D Agent ID or ENS name"
            }
        }
    },
    "author": "3d-agent",
    "createdAt": "2026-04-17",
    "homepage": "https://3dagent.vercel.app",
    "version": "1.0.0"
}
```

Read current LobeHub plugin schema and adapt fields as needed — this is a starting point, not a finished spec.

### `GET /api/lobehub/config`

- Public (no auth).
- Returns the plugin manifest dynamically so we can version-bump without redeploying the static file.
- Same JSON shape as the static file; prefer CORS `*` so LobeHub can fetch.

### `GET /api/lobehub/manifest`

- Same as above but shaped as LobeHub's marketplace submission format if different.
- If LobeHub has a single format, this endpoint may be a redirect to `/config`.

## Constraints

- No new deps.
- Valid JSON (run `node -e "require('./public/.well-known/lobehub-plugin.json')"`).
- CORS enabled.

## Acceptance

- `curl https://your-preview.vercel.app/.well-known/lobehub-plugin.json` returns the JSON.
- `curl .../api/lobehub/config` returns the same shape.
- `npm run build` clean.

## Report

- Link to the LobeHub plugin schema you referenced (version + date).
- Any fields you guessed vs confirmed from their docs.
