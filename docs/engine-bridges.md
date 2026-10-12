# Engine bridges: Unity, Godot, and Unreal

A glTF viewer answers "does the mesh load." A game engine's import step asks
a different question: can this ship in *my* project, with *my* pipeline, and
drop into my scene with one click? The Forge API already generates the
mesh; these three packages are the one-click part, one per engine, each
calling the exact same [public Forge API](./forge-pipeline.md) a browser
would.

- **Contract:** [`specs/ENGINE_BRIDGE.md`](https://github.com/nirholas/three.ws/blob/main/specs/ENGINE_BRIDGE.md), the shared auth/catalog/generate/poll/download/import contract all three bridges implement independently.
- **Unity:** [`packages/unity-bridge`](https://github.com/nirholas/three.ws/tree/main/packages/unity-bridge), a UPM package using [glTFast](https://github.com/atteneder/glTFast) to import.
- **Godot:** [`packages/godot-bridge`](https://github.com/nirholas/three.ws/tree/main/packages/godot-bridge), an editor addon using Godot's own native `GLTFDocument` glTF importer.
- **Unreal:** [`packages/unreal-bridge`](https://github.com/nirholas/three.ws/tree/main/packages/unreal-bridge), a plugin using Unreal's own Interchange glTF pipeline.

No bridge parses glTF itself. Each one is an HTTP client plus a thin adapter
that hands the downloaded `.glb` to the engine's own first-party importer,
the same split [`packages/blender-mcp`](https://github.com/nirholas/three.ws/tree/main/packages/blender-mcp) and the [Python Forge client](https://github.com/nirholas/three.ws/blob/main/integrations/_pyclient/three_ws_client.py) vendored into the Blender/ComfyUI/Modly plugins already use.

## Why one spec, three implementations

Unity (C#), Godot (GDScript), and Unreal (C++) have nothing in common at the
language level, but the API they're calling is one surface:
[`POST /api/forge`](./forge-pipeline.md) to submit, `GET
/api/forge?job=<id>` to poll, and a plain HTTPS GET to download the
finished `.glb`. Writing the contract down once in
[`specs/ENGINE_BRIDGE.md`](https://github.com/nirholas/three.ws/blob/main/specs/ENGINE_BRIDGE.md)
means a fourth engine (or a bug report against one of the three) has a
single source of truth to check against, instead of three READMEs that can
quietly drift.

Every bridge exposes the same four import settings from the spec under the
same names, mapped onto whatever each engine calls its own equivalent:

| Setting | Unity | Godot | Unreal |
|---|---|---|---|
| `generate_colliders` | `MeshCollider` (convex) | `ConvexPolygonShape3D` | Bounding-box `UBodySetup` |
| `import_materials` | glTFast materials, or a flat `Standard` | glTF PBR materials, or stripped | Interchange materials, or `UMaterial::GetDefaultMaterial` |
| `scale` | Applied to the imported root's `localScale` | Applied to the imported root's `scale` | Applied by the caller at the actor level |
| `destination` | Scene root / parent transform | Scene tree parent | Content-browser path (`/Game/...`) |

## Auth and routing

Generation is anonymous by default: each bridge generates a random
`x-forge-client` handle per client instance, the same free-first routing
and lane health every other Forge caller gets (see [the pipeline
doc](./forge-pipeline.md#4-routing-free-first-subject-aware-health-tempered)
for the backend grid and circuit breakers). Set a provider key on any client (`ProviderKey` in
Unity/Unreal, `provider_key` in Godot) to use your own BYOK geometry
provider instead of the free-tier lane.

## Try it

- **Unity:** install via Package Manager git URL, then **Window > three.ws
  > Forge Bridge**. See [`packages/unity-bridge/README.md`](https://github.com/nirholas/three.ws/blob/main/packages/unity-bridge/README.md).
- **Godot:** copy the addon into `addons/`, enable it in Project Settings,
  use the **three.ws Forge** dock. See
  [`packages/godot-bridge/README.md`](https://github.com/nirholas/three.ws/blob/main/packages/godot-bridge/README.md).
- **Unreal:** copy the plugin into `Plugins/`, enable Interchange glTF
  import, use **Window > three.ws Forge Bridge**. See
  [`packages/unreal-bridge/README.md`](https://github.com/nirholas/three.ws/blob/main/packages/unreal-bridge/README.md).

Related: [the Forge pipeline](./forge-pipeline.md) for how a submission is
routed and served, [Engine QA](./engine-qa.md) for grading whether an
imported mesh will actually run at 60fps once it's in the engine.
