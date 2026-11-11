---
name: free-text-to-3d
description: Generate a textured GLB 3D model from a text prompt with the free forge_free tool of the three.ws MCP server, then hand back the model URL and a browser viewer link. Use when asked to make a 3D model, prop or character mesh from a description at no cost.
---

# Free text to 3D with forge_free

The plugin starts `@three-ws/mcp-server` over stdio (`npx -y @three-ws/mcp-server`, bin `3d-agent-mcp`). The server exposes many tools. Most are paid and quote their price in their description. This skill covers `forge_free`, which needs no payment, wallet or API key.

## Environment

None is required to start. Optional tuning for `forge_free`:

- `FORGE_FREE_API_BASE`: three.ws origin, default `https://three.ws`.
- `FORGE_FREE_TIMEOUT_MS`: overall polling budget, default `180000`.
- `FORGE_FREE_POLL_MS`: poll interval, default `3000`.
- `FORGE_FREE_ATTEMPTS`: attempts before giving up, default 2, maximum 4.

The server also reads `MCP_SVM_PAYMENT_ADDRESS`, a payout wallet for operators who collect for paid tools. Leave it unset unless the user runs the server to be paid.

## The tool

`forge_free` takes:

- `prompt` (string, 3-1000 characters, required): one object or character with its key materials and colors. The free lane conditions on roughly the first 77 characters, so lead with the subject.
- `tier` (`draft`, `standard` or `high`, optional, default `draft`): all three are free. Higher tiers only take longer.

It is text only. It does not accept photos.

A successful call returns JSON with `ok: true`, `free: true`, `cost: "$0.00"`, `glbUrl`, `preview` (a three.ws viewer link that renders the model in a browser), `tier`, `backend`, `durable`, `jobId` and `durationMs`. If `durable` is false the URL is a temporary provider file and the result carries a `warning`. Tell the user to open or download it promptly.

Failures come back as a structured error, for example `invalid_input` for a prompt under 3 characters, or `lane_degraded` when the free lane produced an unreachable URL. For `lane_degraded`, wait a little and call again.

## Worked example

Request: "Make me a low-poly fox I can drop into a scene."

1. Call `forge_free` with `{ "prompt": "a low-poly orange fox sitting, flat shaded, white chest", "tier": "draft" }`.
2. Return `glbUrl` as the download and `preview` as the link to inspect it.
3. If the user wants more detail, call again with `tier: "high"`.

## Notes

- The same prompt can produce a different mesh on each call.
- Other tools on this server quote a price and ask for an x402 payment. Never pay on the user's behalf. Show the recipient, amount and network and wait for their explicit yes.
