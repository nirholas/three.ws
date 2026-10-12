# com.three-ws.forge-bridge

Unity UPM package that calls the public [three.ws](https://three.ws) Forge API
to generate a 3D mesh from a text prompt or reference image and imports the
result into your scene with [glTFast](https://github.com/atteneder/glTFast).

Implements [`specs/ENGINE_BRIDGE.md`](../../specs/ENGINE_BRIDGE.md), the
contract shared with [`packages/godot-bridge`](../godot-bridge) and
[`packages/unreal-bridge`](../unreal-bridge). No glTF parsing lives in this
package: `ThreeWsForgeImporter` hands the downloaded `.glb` straight to
glTFast.

## Install

### Option A: Git URL (recommended)

In Unity, open **Window > Package Manager > + > Add package from git URL**
and enter:

```
https://github.com/nirholas/three.ws.git?path=/packages/unity-bridge
```

### Option B: Local path

Clone this repository, then in Package Manager choose
**+ > Add package from disk** and select
`packages/unity-bridge/package.json`.

Unity resolves the `com.unity.cloud.gltfast` and
`com.unity.nuget.newtonsoft-json` dependencies automatically from the
registry.

## Runnable example

1. After installing, open **Window > Package Manager**, select
   **three.ws Forge Bridge** in the *In Project* list, and import the
   **Generate From Prompt** sample.
2. Open **Window > three.ws > Forge Bridge**.
3. Type a prompt (e.g. "a weathered lighthouse"), pick a tier, and click
   **Generate and import**. The window submits the prompt to
   `POST /api/forge`, polls `GET /api/forge?job=<id>` until it finishes,
   downloads the `.glb`, and imports it into the open scene as a selected,
   undo-able `GameObject`.

The imported sample script
(`Samples~/GenerateFromPrompt/GenerateFromPromptSample.cs`) shows the same
flow driven at runtime instead of from editor tooling: attach it to any
`GameObject`, enter Play mode, and press **Space** to generate and drop a
mesh in front of the main camera.

## API surface

- `ThreeWsClient` (`Runtime/ThreeWsClient.cs`): `GetCatalogAsync`,
  `GetHealthAsync`, `UploadReferenceImageAsync`, `SubmitTextAsync`,
  `SubmitImageAsync`, `WaitForGlbAsync`, `DownloadGlbAsync`.
- `ThreeWsForgeImporter` (`Runtime/ThreeWsForgeImporter.cs`):
  `ImportGlbAsync(path, parent, settings)` wraps glTFast's
  `GltfImport.Load` / `InstantiateMainSceneAsync` and applies the shared
  import settings (`generate_colliders`, `import_materials`, `scale`) from
  the spec.

Generation is anonymous by default (an `x-forge-client` handle is generated
per `ThreeWsClient` instance). Set `ThreeWsClient.ProviderKey` to use your
own BYOK geometry provider key instead of the free-tier lane; see section 1
of the spec.

## License

Apache-2.0, see [`LICENSE`](./LICENSE).
