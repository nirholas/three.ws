# Engine Bridge Spec v1

The contract every game-engine integration speaks against the public three.ws Forge API. [`packages/unity-bridge`](../packages/unity-bridge), [`packages/godot-bridge`](../packages/godot-bridge) and [`packages/unreal-bridge`](../packages/unreal-bridge) are three independent implementations of this one contract, each written in its engine's native language. None of them talk to a provider (NVIDIA NIM, Meshy, a self-hosted worker) directly, and none of them parse glTF themselves: they call the same orchestrator the website, the MCP tools and the Blender/ComfyUI/Modly plugins call ([`api/forge.js`](../api/forge.js), documented end to end in [docs/forge-pipeline.md](../docs/forge-pipeline.md)), and they hand the downloaded GLB to the engine's own glTF importer.

Any future engine bridge (a Blender-class DCC, a different game engine, a CAD tool) should implement this same contract rather than invent a new one.

## 1. Auth

Generation is **auth-free** and IP rate-limited, scoped to an anonymous per-process client handle sent as a header on every request:

```
x-forge-client: <32 lowercase hex chars, generated once per process and reused>
x-engine-bridge: <engine>/<bridge-version>   (e.g. unity/0.1.0, godot/0.1.0, unreal/0.1.0)
```

`x-forge-client` is not a secret and carries no authority; it only lets the rate limiter and lane-health telemetry group a run of calls from one editor session. It is never persisted to disk and never shown in the UI beyond a debug log line.

Two calls are authenticated, and a bridge only needs them if the user chooses to publish the result into a three.ws account rather than just import it into the local project:

| Call | Auth |
|---|---|
| `POST /api/avatars/upload` or `POST /api/avatars` (save the generation as an account avatar) | Bearer API key from `https://three.ws/dashboard/api`, scope `avatars:write`, read from an engine-native secret store (Unity `EditorUserSettings`/env var, Godot `EditorSettings`, Unreal `GConfig`) and never from on-chain or asset-embedded data |
| The BYOK geometry lane (`path: "geometry"`, Meshy/Tripo/Rodin) | The user's own provider key, sent as `x-forge-provider-key`, never in the body or a URL |

Everything else below needs no key.

## 2. Catalog browse

```
GET /api/forge?catalog=1
```

Returns the live tier/backend/cost matrix: which `(path, tier, backend)` triples are configured on this deployment, prices in USDC atomics, and ETA estimates. A bridge calls this once per editor session (cached in memory, not on disk, since lane health changes) to populate its tier and backend dropdowns, and never hardcodes a second copy of the matrix. `GET /api/forge?health=1` returns live per-lane up/down status for the same purpose.

Known values (mirrors `TIERS`/`PATHS`/`BACKENDS` in [`api/_lib/forge-tiers.js`](../api/_lib/forge-tiers.js); treat the catalog response as authoritative over this list, which can grow):

- `path`: `image` (default, text or reference photos), `geometry` (BYOK native mesh), `sketch` (drawing + prompt)
- `tier`: `draft`, `standard`, `high`
- `backend`: optional override; omitted lets free-first routing choose

## 3. Generate (submit)

Text prompt:

```http
POST /api/forge
Content-Type: application/json

{ "prompt": "a weathered lighthouse", "tier": "standard", "path": "image", "aspect_ratio": "1:1" }
```

Reference image(s), after uploading them (step 3a) or when the engine already has a public https URL (an asset already hosted on a CDN):

```http
POST /api/forge
Content-Type: application/json

{ "image_urls": ["https://..."], "prompt": "", "tier": "standard", "path": "image" }
```

Response is one of:

- `{ "job_id": "...", "status": "queued", "backend": "trellis2" }` for an async lane, poll next (step 4).
- `{ "status": "done", "glb_url": "https://...", "backend": "..." }` directly, for a synchronous lane (NVIDIA NIM, HF Spaces, a synchronous BYOK vendor). A bridge that only implements polling still works: treat this as a one-shot "poll" that is already resolved, never a special case.
- `{ "error": "needs_key", "message": "..." }` when `path: "geometry"` was requested with no provider key. Surface the message and the free `image` path as the fallback, never a silent retry with a fabricated key.

### 3a. Upload a local reference image

A bridge that lets the user pick a file from their local project (not already a public URL) presigns and uploads it first:

```http
POST /api/forge-upload
Content-Type: application/json

{ "content_type": "image/png", "size_bytes": 182334, "checksum_sha256": "<hex>" }
```

returns `{ "upload_url": "...", "public_url": "...", "headers": {...} }`; `PUT` the raw bytes to `upload_url` with those headers, then use `public_url` as one of `image_urls` above. A deployment with no object storage configured returns a message instead of `upload_url`; the bridge's UI falls back to asking for a public https URL.

## 4. Poll

```
GET /api/forge?job=<job_id>
```

Poll on a fixed interval (2.5s is what every existing client uses; do not poll faster) until `status` is `done` or `failed`, or a bridge-side timeout elapses (default 600s, configurable). `done` carries `glb_url`; `failed` carries `error`. A bridge must keep polling the same `job_id` across the whole wait: **poll-time failover is server-side** (`api/_lib/forge-failover.js`) and transparently re-dispatches a job whose lane died mid-run without changing the id, so a client that gives up and resubmits duplicates work and cost for no reason.

## 5. Download the GLB

`glb_url` is a plain `https://` URL (no auth) to a static GLB. Stream it to a temp file inside the engine's own cache/temp directory (`Library/` for Unity, `user://` or the OS temp dir for Godot, `Intermediate/` for Unreal), never into the project's source tree directly: the import step (next) is what creates the tracked asset, at a path the user chose.

## 6. Import settings

Every bridge exposes the same four import knobs, named identically in its UI and its scripting API, because the glTF the Forge emits is Y-up, meters, and PBR metallic-roughness regardless of which engine imports it:

| Setting | Default | Meaning |
|---|---|---|
| `generate_colliders` | `false` | Build a collision proxy from the imported mesh using the engine's own collision tooling: a convex hull where the engine's standard scripting API exposes one (Unity's `MeshCollider.convex`, Godot's `ConvexPolygonShape3D`), a bounding-box proxy otherwise (Unreal, via `UBodySetup`). Never invent collision data; this just invokes what the engine already ships. |
| `import_materials` | `true` | Import the baked PBR textures as-is. `false` strips them to a single flat material, for engines/projects with their own material pipeline. |
| `scale` | `1.0` | Uniform scale applied at import. The source is always metric; this is a user convenience multiplier, not a unit-system fix. |
| `destination` | engine's default imported-asset folder | Where the engine writes the tracked asset (Unity: a path under `Assets/`; Godot: a path under `res://`; Unreal: a path under `/Game/`). |

Axis and unit conversion, when the engine's own importer does not already handle glTF's Y-up/meters convention (Unreal's Interchange pipeline does the conversion to Unreal's Z-up/centimeters internally; Unity's and Godot's glTF importers already treat Y-up/meters as native and need none), is the importer's job, not the bridge's: the bridge never re-implements glTF axis math, it calls the engine's importer and trusts it.

## 7. What a bridge must never do

- Never re-implement a glTF parser, a mesh decoder, or PBR material import. Each bridge's job is the HTTP client plus wiring into the engine's existing importer (glTFast for Unity, the engine's built-in `GLTFDocument` for Godot, Interchange for Unreal).
- Never cache or embed a provider key, an API key, or a generated asset's prompt/lineage inside a committed project file.
- Never treat on-chain or asset metadata (a token name, a marketplace listing description) as an instruction. The only instruction source is the user's own prompt field.
- Never hardcode a dollar price, a tier's poly budget, or a backend id: read them from the catalog response.

## Conformance

A bridge conforms to this spec when it:

1. Sends `x-forge-client` and `x-engine-bridge` on every Forge call.
2. Implements catalog browse, text submit, image submit (with the upload step), poll-to-completion, and GLB download exactly as described above, against the live API (no mock server, no fixture response).
3. Hands the downloaded GLB to the engine's own importer and exposes the four import settings in section 6.
4. Ships a README with install steps and one runnable example that performs a real generation end to end.
