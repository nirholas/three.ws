---
name: blender-3d-pipeline
description: Inspect, convert, optimize, render and script 3D files with a local headless Blender through the blender MCP server. Use when a task involves a GLB, glTF, FBX, OBJ, STL, PLY, DAE, USD or .blend file, or needs a quick preview image or a model generated from text.
---

# Blender 3D pipeline

The plugin's `.mcp.json` launches `npx -y @three-ws/blender-mcp` (Node 20 or newer). It drives the Blender 3.0+ already installed on this machine, with no GUI and no add-on. Blender is found on PATH and at the standard install locations, or set `BLENDER_PATH` to the executable.

## Tools

- `blender_info`: report the Blender executable, version, render engines and supported formats. Call it first if anything fails.
- `blender_scene_info` (`input`): objects, triangle and vertex counts, materials, bones, animations, a texture inventory with byte sizes, and bounds. Read-only.
- `blender_convert` (`input`, `output`, `apply_modifiers`, `scale`): change format; the output extension picks the format (.glb, .gltf, .fbx, .obj, .stl, .ply, .dae, .abc, .usd*, .x3d, .blend). Does not reduce size.
- `blender_optimize` (`input`, `output`, `max_triangles`, `max_texture_px`, `compress`): decimate to a triangle budget, shrink textures, purge unused data, compress with `meshopt` (default), `draco` or `none`. Returns before and after numbers.
- `blender_render` (`input`, `output`, `engine`, `samples`, `resolution`, `transparent`, `views`): a PNG preview returned inline so you can look at it. Adds a camera and light if the scene has none.
- `blender_run_python` (`code`, `input`, `output`, `apply_modifiers`): run bpy code. `bpy`, `math` and `Vector` are pre-imported; assign a JSON-serializable value to `result` to get it back.
- `blender_forge_import` (`prompt`, `image`, `image_url`, `output`, `tier`, `lane`, `backend`, `aspect_ratio`): generate a model on the three.ws Forge pipeline and bring it into Blender. The default image lane is free and needs no key. Describe one subject per call.

## Workflow for a heavy asset

1. `blender_scene_info` to see whether triangles or textures dominate.
2. `blender_optimize` with `max_triangles` and `max_texture_px` sized for the target (for example 50000 and 1024 for a web viewer).
3. `blender_render` the result with `views` greater than 1 to check a decimated or skinned mesh from several angles.

Input files are never modified; omit `output` and results land in the server workdir (`BLENDER_MCP_WORKDIR`).

## Example

User: "Make this chair.fbx small enough for a website."

1. `blender_scene_info` with `{"input": "chair.fbx"}`.
2. `blender_optimize` with `{"input": "chair.fbx", "output": "chair.glb", "max_triangles": 30000, "max_texture_px": 1024}`.
3. `blender_render` with `{"input": "chair.glb", "views": 3}` and report the before and after sizes.

## Environment

All optional: `BLENDER_PATH`, `BLENDER_MCP_TIMEOUT_MS`, `BLENDER_MCP_WORKDIR`, `BLENDER_MCP_MAX_CONCURRENCY`, `THREE_WS_BASE`, `THREE_WS_FORGE_PROVIDER_KEY` (only for the `geometry` lane). Set `BLENDER_MCP_ALLOW_PYTHON=0` to withdraw `blender_run_python`, which runs arbitrary Python with this server's file permissions.
