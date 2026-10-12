# ThreeWsBridge

Unreal Engine plugin that calls the public [three.ws](https://three.ws) Forge
API to generate a 3D mesh from a text prompt or reference image and imports
the result through Unreal's own Interchange glTF pipeline, no third-party
importer required.

Implements [`specs/ENGINE_BRIDGE.md`](../../specs/ENGINE_BRIDGE.md), the
contract shared with [`packages/unity-bridge`](../unity-bridge) and
[`packages/godot-bridge`](../godot-bridge).

## Requirements

- Unreal Engine 5.3 or later.
- Interchange glTF import enabled: **Edit > Project Settings > Editor >
  Interchange Import > glTF** (on by default in 5.3+; the plugin's import
  call fails cleanly with a descriptive error if it's off).

## Install

1. Copy `packages/unreal-bridge/` into your project's `Plugins/ThreeWsBridge`
   directory (or add this repository as a git submodule there).
2. Open the project; Unreal prompts to rebuild the plugin's modules. Accept.
3. In the editor: **Edit > Plugins**, confirm **three.ws Forge Bridge**
   (under *Importers*) is enabled.

## Runnable example

**Window > three.ws Forge Bridge** opens a dock tab with a prompt field, a
tier dropdown, and a **Generate and import** button. Clicking it:

1. Submits the prompt to `POST /api/forge` (`FThreeWsClient::SubmitText`).
2. Polls `GET /api/forge?job=<id>` on the core ticker until the job
   finishes (`FThreeWsClient::WaitForGlb`).
3. Downloads the `.glb` to `Intermediate/ThreeWsForge/forge_tmp.glb`
   (`FThreeWsClient::DownloadGlb`).
4. Imports it via `UInterchangeManager::ImportAssetAsync` into
   `/Game/ThreeWsForge/Generated` (`FThreeWsForgeImporter::ImportGlb`), then
   spawns an `AStaticMeshActor` referencing the imported mesh into the
   currently open level and selects it.

Source: `Source/ThreeWsBridgeEditor/Private/ThreeWsForgeWindow.cpp`.

## API surface

- `FThreeWsClient` (`Source/ThreeWsBridge/Public/ThreeWsClient.h`):
  `GetCatalog`, `GetHealth`, `UploadReferenceImage`, `SubmitText`,
  `SubmitImage`, `WaitForGlb`, `DownloadGlb`. All calls are async and take a
  `TFunction` completion callback; `WaitForGlb` polls on
  `FTSTicker::GetCoreTicker()` so it works from editor-only code with no
  active PIE session.
- `FThreeWsForgeImporter` (`Source/ThreeWsBridge/Public/ThreeWsForgeImporter.h`):
  `ImportGlb(path, settings, onComplete)` wraps
  `UInterchangeManager::ImportAssetAsync` and applies the shared import
  settings (`generate_colliders` as a bounding-box collision proxy,
  `import_materials`) from the spec.

Generation is anonymous by default (`FThreeWsClient` generates a random
`x-forge-client` handle per instance). Set `ProviderKey` on the client to
use your own BYOK geometry provider key instead of the free-tier lane; see
section 1 of the spec.

## License

Apache-2.0, see [`LICENSE`](./LICENSE).
