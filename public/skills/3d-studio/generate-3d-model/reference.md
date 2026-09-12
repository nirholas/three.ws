# generate-3d-model, full reference

Loaded on demand. The free text→3D path in `SKILL.md` covers most needs; this file
documents the art-directed lanes, the raw REST pipeline, and tuning.

## The three.ws generation lanes

Every lane produces the same artifact, a textured **GLB** plus a viewer link. They
differ in how the mesh is reconstructed and in fidelity.

| Lane | Tool | Cost | Input | Notes |
| --- | --- | --- | --- | --- |
| Free text→3D | `forge_free` | Free | text only | NVIDIA NIM / TRELLIS. Default for this skill. |
| Art-directed | `mesh_forge` | Paid | text, image, or 1 to 4 multi-view images | IBM Granite "prompt director" refines the prompt, FLUX renders a reference, then TRELLIS / Hunyuan3D reconstruct. Higher single-subject fidelity. |
| Avatar | `text_to_avatar` | Paid (free on the hosted studio) | text or image | Tuned for figures/characters. |

The **hosted studio** at `https://three.ws/api/mcp-studio` exposes `forge_free`,
`mesh_forge`, `text_to_avatar`, `rig_mesh`, and `forge_avatar` as a free,
non-account JSON-RPC tool set (the platform covers provider cost). The full three.ws
MCP server (`npx`-distributed) exposes the same tools with the art-directed and
avatar lanes as paid, higher-fidelity options.

## Quality tiers (free lane)

`tier` controls the geometry/texture budget on the free lane:

| Tier | Speed | Mesh density |
| --- | --- | --- |
| `draft` | fastest (default) | light, good for previews |
| `standard` | balanced | medium |
| `high` | slowest | densest |

All three are free. Higher tiers cost only time.

## Prompting for quality

- **Lead with the subject**, then materials, then color: `"a worn leather armchair,
  brass studs, deep oxblood"`.
- Describe **one** object. The lane reconstructs a single subject; scenes and
  multiple objects degrade quality.
- Name the **material and finish** (matte / glossy / metallic / ceramic), it
  drives the texture far more than adjectives like "cool" or "nice".
- Keep it under ~77 meaningful characters of subject description for the free lane.

## Raw REST pipeline (`/api/forge`)

The MCP tools are thin clients over the public `POST /api/forge` endpoint. Use it
directly when you want no MCP client at all.

**Submit a job:**

```bash
curl -s -X POST https://three.ws/api/forge \
  -H 'content-type: application/json' \
  -d '{ "prompt": "a small glossy green ceramic frog figurine", "backend": "nvidia", "path": "image" }'
```

- `backend: "nvidia"` + `path: "image"` pins the free NVIDIA lane.
- The free lane often finishes inside the submit window and returns
  `{ "status": "done", "glb_url": "..." }` directly. Otherwise it returns
  `{ "job_id": "..." }`.

**Poll until done:**

```bash
curl -s "https://three.ws/api/forge?job=<job_id>" -H 'accept: application/json'
```

Terminal states: `{"status":"done","glb_url":"..."}` or
`{"status":"failed","error":"..."}`.

**Build the viewer link** yourself from any GLB URL:

```
https://three.ws/viewer?src=<URL-encoded glbUrl>
```

## Error codes

| Code / status | Meaning | Action |
| --- | --- | --- |
| `429` / `rate_limited` / `busy` | Per-IP or global rate limit | Honor `retryAfter` / `retry_after`, then retry. |
| `503` / `not_configured` | Lane momentarily cold or disabled on this deployment | Retry shortly. |
| `lane_degraded` | Produced a URL that was unreachable | Retry; never return the dead URL. |
| `generation_failed` | The job failed | Surface the `error`, adjust the prompt, retry. |
| `timeout` | Generator did not accept/finish in budget | Retry; raise the poll budget if self-hosting. |

## Tuning (self-hosted MCP server)

All optional, with production defaults:

| Env | Default | Purpose |
| --- | --- | --- |
| `FORGE_FREE_API_BASE` | `https://three.ws` | Origin to call. |
| `FORGE_FREE_TIMEOUT_MS` | `180000` | Reconstruct poll budget. |
| `FORGE_FREE_POLL_MS` | `3000` | Poll interval. |
| `FORGE_FREE_ATTEMPTS` | `2` | Retries to land the durable lane before falling back to a verified-reachable result. |
