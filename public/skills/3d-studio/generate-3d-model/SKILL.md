---
name: generate-3d-model
description: Turn a text prompt into a downloadable, textured 3D model (GLB). Use when you or the user want to generate, create, make, or forge a 3D model, asset, object, mesh, or prop from a text description, "make a 3D model of a robot", "generate a GLB of a sword", "I need a 3D chair". Runs on the FREE text→3D lane (no key, no account, free). Returns a GLB URL plus a browser viewer link.
when_to_use: User wants a 3D object/asset/prop from text. For a posable character with a skeleton, use create-3d-avatar. To rig an existing GLB, use rig-a-model.
license: MIT
metadata:
  category: 3d/creative
  cross-platform-safe: true
  pack: three-ws-skills
---

# Generate a 3D model from text

Turn a natural-language prompt into a textured, downloadable **GLB** model on the
**free** three.ws text→3D lane (NVIDIA NIM / Microsoft TRELLIS). No API key and no
account, the platform's server-side keys cover provider cost.

The result is always two things: a durable **`glbUrl`** (download / import into any
3D tool) and a **viewer link** that renders the model in the browser.

## When to use which tool

| Goal | Use |
| --- | --- |
| A single object / prop / creature from text | this skill (free lane) |
| A posable humanoid **character with a skeleton** | `create-3d-avatar` |
| Add a skeleton to a GLB you already have | `rig-a-model` |

## Fastest path, the MCP tool

If the three.ws MCP server is connected, call the free tool directly:

- **Tool:** `forge_free`
- **Input:** `{ "prompt": "<description>", "tier": "draft" }`
  - `prompt`, 3 to 1000 chars. Lead with the subject, then its key materials and
    colors. The free lane conditions on ~77 characters, so front-load what matters:
    `"a friendly round robot mascot, glossy white plastic, big blue eyes"`.
  - `tier`, `draft` (fast, default), `standard`, or `high`. All free; higher tiers
    only take longer.
- **Returns:** `glbUrl`, `viewerUrl`, `tier`, `backend`, `durationMs`.

This is text-only (the free TRELLIS preview does not accept uploaded photos). For
image / multi-view → 3D, use the art-directed lanes described in
[reference.md](reference.md).

## Portable path, the hosted HTTP endpoint

No MCP client required. The same free lane is a public JSON-RPC endpoint at
`https://three.ws/api/mcp-studio` (no auth, no account):

```bash
curl -s -X POST https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "forge_free",
      "arguments": { "prompt": "a small glossy green ceramic frog figurine", "tier": "draft" }
    }
  }'
```

Response (`structuredContent`) carries the model:

```json
{
  "kind": "model",
  "glbUrl": "https://three.ws/cdn/creations/abc123/mesh.glb",
  "viewerUrl": "https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2F...",
  "format": "glb",
  "prompt": "a small glossy green ceramic frog figurine"
}
```

Discover the full free tool set first with `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.

## What to do with the result

1. Give the user the **viewer link**, they can rotate and inspect the model in the
   browser immediately.
2. Give the **`glbUrl`** for download / import into Blender, Unity, three.js, etc.
3. If they want it animated, feed `glbUrl` into the `rig-a-model` skill.

## Higher-fidelity & art-directed lanes

The full three.ws MCP server also exposes art-directed and image→3D lanes
(`mesh_forge`) and paid lanes with denser geometry. Those, the tier trade-offs, the
raw `POST /api/forge` REST shape, and full error handling are in
[reference.md](reference.md), load it only when you need more than the free
text→3D path above.

## Errors

The free lane is shared and protected by per-IP rate limits and a global capacity
breaker. Handle these and retry rather than failing:

- `rate_limited` / `busy`, honor `retryAfter` (seconds) and try again.
- `not_configured`, the durable lane is momentarily cold; retry shortly.
- `lane_degraded`, a result was produced but its URL was unreachable; retry.

Never report a dead or empty link as success, only return a `glbUrl` the call
actually produced.
