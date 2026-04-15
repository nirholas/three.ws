# 02-05 — Generated avatar OG / share image

## Why it matters

The moment a user gets their 3D avatar is also the moment they're most likely to share. If the share link unfurls as a generic card, that impulse dies. A static OG image rendered from a canonical avatar pose turns the first-agent-created moment into a recruiting surface for the product.

## Context

- OG endpoint scaffold exists: [api/agent-og.js](../../api/agent-og.js).
- Per-agent record: `api/agents/[id].js`, table `agents` (reference [api/_lib/schema.sql](../../api/_lib/schema.sql)).
- Avatar storage: `avatars.storage_key` in R2, helper in [api/_lib/r2.js](../../api/_lib/r2.js).
- Three.js is already a dep — server-side render via `@react-three/offscreen` or node-three is NOT in scope. Use a pre-rendered "hero pose" PNG captured on the client immediately after avatar generation.

## What to build

### Client — hero-pose capture on the review screen

At the end of Layer 2's review flow (after 02-04 "first-agent-landing"):

- Spin the avatar into a canonical 3/4 hero pose (slight angle, eyes toward camera, neutral expression).
- Grab a 1200×630 PNG from the model-viewer canvas via `toBlob()`.
- `POST /api/agents/:id/og-image` with the blob. Server stores it at R2 key `agents/:id/og.png` and updates `agents.og_key`.

### Endpoint — `api/agents/[id]/og-image.js`

- `POST`: session-authed, owner-only. Multipart or raw PNG body. Validates ≤ 1 MB, dimensions exactly 1200×630.
- `GET`: public, 302 to a signed R2 URL (short TTL) or stream bytes through with `Cache-Control: public, max-age=3600`.

### Unfurl path — [api/agent-og.js](../../api/agent-og.js)

Extend the existing handler:

- If `agents.og_key` is set, serve that image.
- If not, render a fallback card (text-only: agent name, handle, chip color) and stream a PNG — reuse existing fallback if one exists.
- `Content-Type: image/png`, `Cache-Control: public, max-age=86400`.

### Agent page meta

On [public/agent/index.html](../../public/agent/index.html), ensure `<meta property="og:image">` points to `/api/agents/:id/og-image` (not a static asset). Same for `twitter:image`.

## Out of scope

- Animated OGs (video OG).
- Server-side Three.js rendering.
- Customising the pose per-user (one canonical pose is fine).
- Editing existing OGs — regenerate on avatar-swap / regenerate (covered implicitly by re-running the client capture after 03-* flows).

## Acceptance

1. Create a new agent via the Layer 2 flow → the review screen produces an OG PNG stored in R2 within 2s.
2. `curl -I https://…/api/agents/:id/og-image` returns `image/png`, 200.
3. Paste the agent URL into iMessage, Slack, and Twitter → the preview card shows the avatar hero pose.
4. Agents with no captured OG still unfurl with the fallback text card.
5. `node --check` passes on new/modified server files.
