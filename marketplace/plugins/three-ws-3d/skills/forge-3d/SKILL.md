---
name: forge-3d
description: Generate a textured 3D GLB model from a text prompt for FREE — no payment, API key, or wallet. Use when you or the user want to make a 3D model, mesh, object, prop, or character from a description, draft a 3D asset, or get a downloadable GLB from text. Covers "make a 3D model of...", "forge a mesh", "text to 3D", "generate a GLB".
---

# Forge 3D — free text → 3D

Turn a sentence into a textured, downloadable 3D model at zero cost. This is the same free engine the [three.ws/forge](https://three.ws/forge) web page uses for prompt drafts.

## Tool

`forge_free` (three.ws MCP server, `@three-ws/mcp-server`).

- **Lane:** FREE. No x402 payment, no API key, no wallet, no `$THREE` required.
- **Backend:** the three.ws `POST /api/forge` pipeline on the free Microsoft TRELLIS lane (our own GPU workers first, NVIDIA NIM as the last resort).
- **Mode:** text only. NVIDIA's hosted TRELLIS preview does not accept uploaded photos — for image or multi-view → 3D, use the `mesh-forge` skill instead.

## Inputs

| Param | Required | Notes |
| --- | --- | --- |
| `prompt` | yes | 3–1000 chars. Describe one object or character. TRELLIS conditions on ~77 characters, so lead with the subject plus its key materials and colors, e.g. `"a friendly round robot mascot, glossy white plastic"`. |
| `tier` | no | `draft` (fast, default), `standard` (balanced), or `high` (densest mesh). All three are free — higher tiers only cost more time. |

## Outputs

The tool returns:

- `glbUrl` — a durable URL to the generated `.glb` file (download or load directly into any glTF viewer / Three.js scene).
- `viewerUrl` — a three.ws viewer link, `https://three.ws/viewer?src=<glbUrl>`, that renders the model in the browser.
- the quality `tier` used and the backend that produced it.

## How to run

1. Read the user's description. Pick `tier` (`draft` unless they ask for higher fidelity).
2. Call `forge_free` with `{ prompt, tier }`.
3. Return the `glbUrl` (for download) and the `viewerUrl` (clickable preview) to the user. Mention the tier used.
4. To make the result animation-ready, feed `glbUrl` to the `auto-rig` skill (`rig_mesh`).

## Notes

- One object/character per prompt produces the cleanest mesh. For a full scene of multiple placed objects, use the `scene` server's `compose_scene` instead.
- Free tier is real generation, not a placeholder — generation takes from a few seconds (`draft`) up to a couple of minutes (`high`). Report the wait honestly; never fake progress.
