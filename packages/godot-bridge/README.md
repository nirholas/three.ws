# three_ws_bridge

Godot 4 addon that calls the public [three.ws](https://three.ws) Forge API to
generate a 3D mesh from a text prompt or reference image and imports the
result with Godot's native glTF importer (`GLTFDocument`/`GLTFState`), no
third-party import library required.

Implements [`specs/ENGINE_BRIDGE.md`](../../specs/ENGINE_BRIDGE.md), the
contract shared with [`packages/unity-bridge`](../unity-bridge) and
[`packages/unreal-bridge`](../unreal-bridge).

## Install

1. Copy `addons/three_ws_bridge/` into your project's `addons/` directory
   (or add this repository as a git submodule and symlink it there).
2. In Godot: **Project > Project Settings > Plugins**, enable **three.ws
   Forge Bridge**.
3. A **three.ws Forge** dock appears in the editor (bottom panel) with a
   prompt field and a Generate button.

## Runnable example

`example/` is a standalone Godot project that embeds the addon.

```sh
# Editor, interactive:
godot --path packages/godot-bridge
# press Play, type a prompt, click Generate.

# Headless, non-interactive smoke test against the live API:
godot --headless --path packages/godot-bridge --script test/smoke_test.gd
```

The example scene (`example/main.gd`) wires a `ThreeWsClient` node to a
`LineEdit` + `Button` + `Label` UI: typing a prompt and pressing Generate
submits it to `POST /api/forge`, polls `GET /api/forge?job=<id>` until the
job finishes, downloads the `.glb`, and imports it into the scene with
collision generated (`generate_colliders: true`).

`test/smoke_test.gd` is the same flow run headlessly end to end against the
live API for CI/local verification: catalog browse, text submit, poll,
download, import, and a printed PASS/FAIL with a process exit code.

## API surface

- `ThreeWsClient` (`addons/three_ws_bridge/three_ws_client.gd`): add one as
  a child of any node that stays in the tree for the life of a request (the
  dock, an autoload, or a scene root). Methods: `catalog()`, `health()`,
  `upload_reference_image(bytes, content_type)`, `submit_text(prompt, tier,
  path, backend, aspect_ratio)`, `submit_image(image_urls, prompt, tier,
  path, backend)`, `wait_for_glb(job_id, timeout_sec)`,
  `download_glb(url, destination_path)`.
- `ThreeWsForgeImporter` (`addons/three_ws_bridge/forge_importer.gd`):
  `import_glb(path, import_settings)` wraps `GLTFDocument.append_from_file`
  + `generate_scene()` and applies the shared import settings
  (`generate_colliders`, `import_materials`, `scale`) from the spec.
  `save_as_resource(node, destination_path)` packs the result into a
  `.tscn` on disk.

Generation is anonymous by default (`ThreeWsClient` generates a random
`x-forge-client` handle per instance). Set `provider_key` on the client to
use your own BYOK geometry provider key instead of the free-tier lane; see
section 1 of the spec.

## License

Apache-2.0, see [`LICENSE`](./LICENSE).
