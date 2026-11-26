# Forge Bridge by three.ws for Godot 4

Generate a textured 3D mesh from a text prompt or reference photos with the free
[three.ws](https://three.ws) Forge pipeline and import the result into your scene
with Godot's own glTF importer (`GLTFDocument` and `GLTFState`). No third-party
import library is needed.

## Install

1. Copy this `three_ws_bridge` folder into your project's `addons/` directory,
   or install it from the Godot Asset Library.
2. Open **Project > Project Settings > Plugins** and enable **Forge Bridge by three.ws**.
3. A **Forge by three.ws** dock appears in the editor with a prompt field and a Generate button.

## Use from your own scripts

- `three_ws_client.gd` (`ThreeWsClient`): add one as a child node to browse the catalog,
  submit a text or image job, poll it to completion and download the `.glb`.
- `forge_importer.gd` (`ThreeWsForgeImporter`): turns the downloaded `.glb` into a node tree
  with collider, material and scale import settings.

Every call goes to the live public three.ws API. The bridge sends the prompt or image you
submit and a random per-install client handle for rate limiting, and nothing else.

## More

Documentation: https://three.ws/docs/engine-bridges
Source and issues: https://github.com/nirholas/three.ws
License: Apache-2.0, see `LICENSE`.
