---
mode: agent
description: "Publish agent-card.json and agent-registration.json for A2A discovery"
---

# 04-04 · A2A discovery: agent-card.json

## Why it matters

A2A (Agent-to-Agent) discovery — other agent runtimes find and introspect yours by fetching a stable JSON at a known path. Required for Lobehub and Claude host integrations (pillar 5) and for onchain portability (pillar 6) since the CID that goes onchain is this file.

## Prerequisites

- Pillar 2 complete — agents have avatars.

## Read these first

- [specs/](../../specs/) — check for an existing manifest spec.
- [src/manifest.js](../../src/manifest.js) — current manifest loader.
- [api/agents.js](../../api/agents.js) — agent record shape.

## Build this

1. **New endpoint** `GET /api/agents/:id/card.json`:
   - Returns the agent card in the A2A convention (use the spec in `specs/` if present; if not, match the shape below).
   - `{ name, description, home, avatar: { url, content_type, size }, skills: [...], identity: { wallet?, chain_id?, erc8004_agent_id? }, endpoints: { embed, postmessage_bridge }, schema_version }`.
   - No auth required — this is public discovery.
   - Etag on the response (hash of the content) so hosts can cache.
2. **Well-known alias** `GET /.well-known/agent-card.json?id=...` → same response. Some consumers only read `.well-known`.
3. **Registration card** `GET /api/agents/:id/registration.json`:
   - Smaller, onchain-bound subset: `{ card_url, card_sha256, avatar_sha256, created_at, wallet }`.
   - Field to record what was pinned to IPFS — the card CID goes onchain in pillar 6.
4. **Viewer link** — add `<link rel="agent-card" href="/api/agents/:id/card.json">` to `/agent/:id` page head.

## Out of scope

- Pinning to IPFS (06-*).
- Onchain registration (06-*).
- Signing the card (06-*).

## Deliverables

- `api/agents/[id]/card.js` or equivalent route.
- `api/agents/[id]/registration.js`.
- `<link>` tag in the agent page head.
- Route entries in `vercel.json`.

## Acceptance

- `curl /api/agents/<id>/card.json` returns valid JSON with all documented fields.
- Response has correct `content-type: application/json` and an `etag`.
- `npm run build` passes.
