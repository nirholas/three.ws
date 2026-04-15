# 06-10 — Onchain: portable agent manifest spec

**Branch:** `feat/manifest-spec-v1`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-05 (deploy)
**Blocks:** 06-11 (validation flow)

## Why it matters

The `agentURI` field in IdentityRegistry currently points to a JSON document with no formal schema. Different hosts will read different keys; agents minted today won't be readable by tools shipped tomorrow. Locking down a v1 manifest schema (and a JSON-Schema validator) protects forward compatibility.

## Read these first

| File | Why |
|:---|:---|
| [src/manifest.js](../../src/manifest.js) | Existing manifest loader. |
| [specs/](../../specs/) | Existing spec files; this prompt adds one. |
| [examples/coach-leo/](../../examples/coach-leo/) | Reference agent — must validate against the new schema after migration. |
| [src/agent-resolver.js](../../src/agent-resolver.js) | Resolver that consumes manifests. |

## Build this

1. Add `specs/AGENT_MANIFEST.md` documenting v1 schema:
   ```jsonc
   {
     "$schema": "https://3dagent.vercel.app/schemas/agent-manifest-v1.json",
     "version": 1,
     "id": "did:erc8004:1:42",
     "name": "Coach Leo",
     "description": "Personal posture coach",
     "avatar": {
       "model_url": "ipfs://bafy.../leo.glb",
       "thumbnail_url": "ipfs://bafy.../thumb.png"
     },
     "skills": [
       { "id": "greet", "version": "1.0.0", "danger": "safe" }
     ],
     "memory": { "mode": "encrypted-ipfs", "root": "ipfs://..." },
     "wallet": "0x...",
     "homepage": "https://3dagent.vercel.app/agent/leo",
     "created_at": "2026-04-15T00:00:00Z",
     "signature": "0x..."  // wallet-signed hash of the rest of the doc
   }
   ```
2. Generate `public/schemas/agent-manifest-v1.json` (JSON Schema draft 2020-12).
3. Add `src/manifest-validate.js` exporting `validateManifest(json)` using zod (mirror schema). Returns `{ ok, errors }`.
4. Update [src/manifest.js](../../src/manifest.js) to call the validator on every load; reject malformed manifests with a structured error.
5. Migrate [examples/coach-leo/](../../examples/coach-leo/) and `src/nich-agent.js` reference manifest to the new shape.
6. Add a CLI: `node scripts/validate-manifest.mjs <url|file>` for external authors.

## Out of scope

- Do not implement v2 yet — version is a literal `1`.
- Do not enforce signature verification yet (next prompt).
- Do not change the on-chain `agentURI` setter.

## Acceptance

- [ ] `validateManifest(coach-leo manifest)` returns `{ ok: true }`.
- [ ] Malformed manifest returns structured errors with paths.
- [ ] CLI exits 0 on valid, 1 on invalid; prints errors clearly.
- [ ] JSON Schema served at `/schemas/agent-manifest-v1.json` with correct content type.

## Test plan

1. `node scripts/validate-manifest.mjs examples/coach-leo/agent.json` → exit 0.
2. Pass a manifest with `version: 2` → exit 1, error mentions version.
3. Pass `https://3dagent.vercel.app/api/agents/<id>/manifest` → expect ok.
4. Open `/schemas/agent-manifest-v1.json` in browser — JSON renders.
