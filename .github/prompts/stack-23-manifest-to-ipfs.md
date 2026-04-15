---
mode: agent
description: "Publish agent manifests to IPFS so agents are portable, censorship-resistant"
---

# Stack Layer 6: Agent Manifest → IPFS

## Problem

Today an agent is a DB row in Neon. For the novel unlock (agent hydrates into any host from chain), the manifest — identity, skills, GLB reference, public memories — must live in content-addressable storage readable by anyone. IPFS is the canonical choice.

## Implementation

### Manifest schema

Conform to [specs/AGENT_MANIFEST.md](specs/AGENT_MANIFEST.md). Minimum fields:
```json
{
  "$schema": "https://3dagent.vercel.app/specs/agent-manifest-v1.json",
  "version": 1,
  "name": "Satoshi",
  "bio": "...",
  "image": "ipfs://bafy.../preview.png",
  "glb": "ipfs://bafy.../model.glb",
  "skills": [
    { "id": "greet", "runtime": "3dagent-v1" }
  ],
  "animations": { "idle": "idle-breathing", ... },
  "publicMemories": [ { "type": "project", "name": "...", "body": "..." } ],
  "createdBy": "0xabc...",
  "createdAt": "2026-04-15T00:00:00Z"
}
```

### Pinning service

Use Pinata, Web3.Storage, or Filecoin via [src/ipfs.js](src/ipfs.js) (already exists — check). Add server-side pinning via `api/ipfs/pin.js`:
- Input: manifest JSON.
- Uploads GLB to IPFS first (gets CID), references it in manifest.
- Pins manifest JSON, returns CID.

### Publish endpoint

`POST /api/avatars/:id/publish`:
- Builds manifest from DB row.
- Uploads GLB to IPFS if not already.
- Pins manifest.
- Stores returned CID in `avatars.manifest_cid`.
- Returns `{ cid, ipfsUrl, gatewayUrl }`.

### Gateway fallback

For rendering from IPFS, support multiple gateways (Cloudflare, ipfs.io, dweb.link). [src/agent-resolver.js](src/agent-resolver.js) tries them in order on failure.

### Update semantics

IPFS is immutable. Each publish creates a new CID. Track history in `avatars.manifest_history` array. The *latest* CID is the one registered on-chain (next prompt).

### Signed manifest

Sign the manifest JSON with the owner's wallet (EIP-712). Store signature inside the manifest as `ownerSignature`. Anyone can verify the manifest was published by the claimed owner.

## Validation

- Publish an avatar → returns an IPFS CID.
- Fetch from `https://ipfs.io/ipfs/<cid>` → returns the manifest JSON.
- Resolver can render the agent using only the CID.
- Tamper with the manifest → signature verification fails.
- `npm run build` passes.

## Do not do this

- Do NOT pin private memories to IPFS. Only `publicMemories`.
- Do NOT trust the pinning service as the only copy — pin via at least two providers.
