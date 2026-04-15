---
mode: agent
description: "Persist created avatars with a user-chosen slug and route /agent/:slug to the viewer"
---

# Stack Layer 2: Avatar Persistence + Slug Routing

## Problem

Once an avatar is generated we need: (1) a stable, shareable URL, (2) a slug chosen by the user, (3) a DB row that the rest of the app treats as canonical.

## Implementation

### Slug picker

On the status page when status hits `ready`, prompt the user for a slug (prefilled with something like `agent-<short>`). Validate client-side: `[a-z0-9-]{3,32}`, no leading/trailing dash.

Call `PATCH /api/avatars/:id`:
```json
{ "slug": "satoshi", "name": "Satoshi", "bio": "optional one-liner" }
```

Server returns 409 if slug is taken, 400 if invalid, 200 with the updated row on success.

### Routing

`/agent/:slug` should route to the viewer with the avatar loaded. Update [src/app.js](src/app.js) URL parser to handle `#agent=<slug>` and also handle path-based `/agent/:slug` via Vercel rewrite (add to [vercel.json](vercel.json)):

```json
{ "source": "/agent/:slug", "destination": "/index.html?agent=:slug" }
```

[src/app.js](src/app.js) reads `agent` from query or hash, fetches `/api/avatars/by-slug/:slug`, and loads the GLB.

### Lookup endpoint

`GET /api/avatars/by-slug/:slug` returns the public view of the avatar (no owner PII):
```json
{ "id", "slug", "name", "bio", "glb_url", "owner": { "handle" }, "created_at" }
```

404 if not found.

### Default slug

If user skips the slug picker, assign `agent-<shortId>` automatically — never leave an avatar sluggless.

### DB migration

`avatars` table: add `slug` (unique, nullable), `bio` (text, nullable). Index on slug.

## Validation

- Create avatar, set slug to `satoshi` → `/agent/satoshi` loads the viewer with the GLB.
- Try to reuse `satoshi` for a second avatar → 409.
- Invalid slug (`SATOSHI!`) → 400 with useful message.
- Skip slug picker → auto-slug assigned, URL still works.
- `/api/avatars/by-slug/nonexistent` → 404.
- `npm run build` passes.

## Do not do this

- Do NOT expose owner wallet or email on the public lookup.
- Do NOT mutate the slug after set without also keeping the old slug as a redirect (out of scope for v1 — disallow slug changes for now).
