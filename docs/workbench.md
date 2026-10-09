# Workbench: image to 3D in a visual workflow

Workbench is a desktop-style 3D workspace that runs in the browser. You drop a photo into the Image node, press **Generate 3D Model**, and the photo runs through a chain of real platform steps (background removal, mesh generation, remeshing, auto-rigging, AI material restyle) before landing in a viewport where you can smooth, decimate, inspect and export it. The chain is a workflow you can edit in a node graph, save, and reuse.

Page: [/workbench](https://three.ws/workbench)

## Why it exists

[Forge](./forge.md) is built for one thing: type or drop something in, get a model out. That is the right shape for most people, but it hides the pipeline. Creators who make game props, printable figures or rigged characters want to choose the steps: cut the background first, retopologize to quads, keep a face budget, rig the result, and export to the format their tool expects. Workbench exposes that pipeline as a layout people already know from desktop 3D apps: an icon rail, a workflow panel of node cards, a large viewport with a tool strip, and an Export menu. Every step calls the same production endpoints Forge uses, so nothing here is a simulation.

## The layout

- **Top bar.** Brand, a live RAM meter (the JavaScript heap this tab is using, shown in Chromium browsers that expose it), links to Forge and these docs, and the theme toggle.
- **Icon rail.** Generate, Workflows, Extensions, Settings. Each view has its own URL hash (`#workflows`, `#extensions`, `#settings`), so you can link straight to one.
- **Generate panel.** A Workflow picker with an edit button, then one card per node in run order. Each card shows its input and output type (`image → mesh`), an on/off switch for optional nodes, a collapse chevron, and its settings. The purple **Generate 3D Model** button runs the workflow and turns into **Cancel** while it runs; underneath it a run log ticks through each step.
- **Viewport.** A toolbar with Undo, Redo, Import, Export, Smooth, Decimate and Free memory; a floating vertical strip with view modes and toggles; a triangle and vertex count in the corner; and a History drawer of everything you have generated in this browser.

## Running a workflow

1. Open [/workbench](https://three.ws/workbench).
2. Drop a PNG, JPG or WebP (up to 8 MB) onto the Image node, click it to browse, or paste an image from the clipboard. The upload starts immediately so the run does not wait for it. No photo? Type a description in the prompt box instead; the server turns it into a reference image first.
3. Adjust the Generate Mesh settings if you want to: **Engine** (Auto routes to the healthiest lane, or pin a specific one), **Quality** (Draft, Standard, or High for $THREE holders), **Resolution**, **Face budget**, **Texture** size, **Compression** (none, Meshopt or Draco) and **Seed**.
4. Press **Generate 3D Model** or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. The overlay shows the current step and elapsed time; the bar under the button fills as nodes finish.
5. When the model lands it appears in the viewport, joins History with a thumbnail, and a toast offers a one-click GLB download.

If a step fails, the toast says why and offers the fix that fits: switch the quality tier, retry on the lane the server suggests, add background removal for a photo it could not use, or try again after a rate limit.

## Nodes

| Node | Takes | Gives | Runs on | What it does |
|---|---|---|---|---|
| Image | | image | Your browser | The photo, or a text prompt. Always first. |
| Remove Background | image | image | GPU worker (`/api/forge-rembg`) | Cuts the subject out with BiRefNet, ISNet or U2-Net before reconstruction. Skipped automatically for a text prompt. |
| Generate Mesh | image | mesh | Forge GPU lanes (`/api/forge`) | Reconstructs a textured GLB. Always present. |
| Restyle Materials | mesh | mesh | `/api/material-studio` | Rewrites the PBR materials from a plain-language look such as "polished gold". |
| Remesh | mesh | mesh | GPU worker (`/api/forge-remesh`) | Server-side retopology to triangles, quads or low poly at a target face count. |
| Decimate | mesh | mesh | Your browser | Edge-collapse simplification that keeps UV seams and borders. |
| Smooth | mesh | mesh | Your browser | Taubin smoothing, which does not shrink the mesh. |
| Auto-Rig | mesh | mesh | `/api/forge?action=rig` | Adds a skeleton and skin weights so the model can animate. |
| Add to Scene | mesh | | Your browser | Loads the result into the viewport and History. Always last. |

When an in-browser step (Decimate, Smooth) is followed by a server step, the edited model is saved to durable storage first so the server works on exactly what you see. The same happens at the end of a run, so the History entry and the GLB link always match the viewport.

## Building workflows

Open **Workflows** from the rail, or press the pencil next to the Workflow picker.

- **Five starting points ship with it:** Image to 3D, Game-ready prop (draft quality, Meshopt, decimate, smooth), Rigged character (background removal, generate, rig), Clean quad retopo, and Restyled prop.
- **Add a node** from the palette under the graph. It is spliced into the chain at the first point where its types fit, so a new Smooth lands after the mesh exists.
- **Wire nodes** by dragging from an output dot to an input dot, or click an output dot and then an input dot (Enter on a focused output dot starts a wire from the keyboard). Click a wired input dot to unplug it. A wire between mismatched types (an image into a mesh input) is refused with a message.
- **Move** a node by its header, **pan** by dragging empty canvas, **delete** the selected node with Delete or Backspace. Image, Generate Mesh and Add to Scene are fixed.
- **Tidy** lays the chain out left to right. **Duplicate**, **New** and **Delete** (with Undo) manage the list.
- The status line validates continuously: one source, one output, one Generate Mesh, a single unbroken chain, matching types. **Use in Generate** is enabled only when the workflow can run.

Workflows are saved in this browser (`localStorage` key `wb:workflows`). Settings → **Restore default workflows** brings back the originals, with Undo.

## Editing in the viewport

- **Import** opens a GLB, glTF, OBJ, STL, PLY or FBX from disk, or a reference image for the Image node. Dropping either kind of file onto the viewport does the same.
- **Smooth** and **Decimate** open a small panel with a slider and Apply. Decimate shows the triangle count you will end up with before you apply it. Both are undoable (up to six steps).
- **Export** writes GLB (textures kept), OBJ, STL or PLY, named after your source. **Copy GLB link** copies the hosted URL of a generated or reopened model as long as it has no unsaved edits.
- **Free memory** unloads the model and releases its GPU buffers.
- The tool strip switches between **Shaded**, **Wireframe**, **Normals** and **Clay** views, toggles the grid, environment lighting and turntable, opens History, frames the model and saves a PNG screenshot.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Generate (or cancel a running generation) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo a mesh edit |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> | Shaded, wireframe, normals, clay |
| <kbd>F</kbd> | Frame the model |
| <kbd>G</kbd> / <kbd>E</kbd> / <kbd>T</kbd> | Grid, environment light, turntable |
| <kbd>H</kbd> | History drawer |
| <kbd>P</kbd> | Screenshot |
| <kbd>Esc</kbd> | Close menus and the History drawer |

## Extensions

The Extensions view reads the live engine catalog (`GET /api/forge?catalog=1`) and lane health (`GET /api/forge?health=1`) and shows one card per engine with its status, whether it is free, what inputs it accepts, and its typical time at Standard quality. Engines that accept your own photos and need no key have a switch that adds or removes them from the Engine picker. Engines that need your own API key link to [Forge](./forge.md), where keys are managed. Below the engines, each mesh tool has a card and an **Add to current workflow** button.

## Settings

Viewport defaults (grid, environment light, turntable after a generation), the site theme, your anonymous browser id (the same one Forge uses, so models made here also show in your Forge gallery), Clear history, Restore default workflows, and a copyable set of `curl` commands that reproduce the current workflow's Generate step.

## Scripts and agents

Everything the Workbench does is a public HTTP call, so a script or an agent can run the same pipeline. Generate from a photo:

```bash
# 1. Ask for an upload slot, then PUT the image to upload_url
curl -s https://three.ws/api/forge-upload -H 'content-type: application/json' \
  -d '{"content_type":"image/png","size_bytes":'$(wc -c < photo.png)'}'
curl -X PUT "$UPLOAD_URL" -H 'content-type: image/png' --data-binary @photo.png

# 2. Submit the public_url
curl -s https://three.ws/api/forge -H 'content-type: application/json' \
  -d '{"path":"image","tier":"standard","image_urls":["'"$PUBLIC_URL"'"]}'

# 3. Poll every few seconds until status is "done", then fetch glb_url
curl -s "https://three.ws/api/forge?job=$JOB_ID"
```

The other nodes are one call each: `POST /api/forge-rembg` with `{ "image_url", "model" }`, `POST /api/forge-remesh` with `{ "mesh_url", "remesh_mode", "target_faces" }` (both answer `{ job_id }`, polled with `?job=`), `POST /api/forge?action=rig` with `{ "glb_url" }`, and `POST /api/material-studio?action=restyle` with `{ "glb_url", "instruction" }`. Full request and response shapes are in the [3D API reference](./3d-api.md).

## Where things live

| Piece | File |
|---|---|
| Page shell | [pages/workbench.html](../pages/workbench.html) |
| Controller (views, panels, toolbar, history) | [src/workbench/main.js](../src/workbench/main.js) |
| Viewport (three.js scene, loaders, exporters, undo) | [src/workbench/viewport.js](../src/workbench/viewport.js) |
| In-browser decimate and smooth | [src/workbench/mesh-tools.js](../src/workbench/mesh-tools.js) |
| Node types, templates, validation, storage | [src/workbench/workflows.js](../src/workbench/workflows.js) |
| Workflow runner | [src/workbench/runner.js](../src/workbench/runner.js) |
| Node graph editor | [src/workbench/graph-editor.js](../src/workbench/graph-editor.js) |
| API client | [src/workbench/api.js](../src/workbench/api.js) |
| Styles | [src/workbench/workbench.css](../src/workbench/workbench.css) |

Related: [Forge](./forge.md) for one-shot generation, [Scene Studio](./scene-studio.md) for composing scenes from the models you make here, and [STRUCTURE.md](../STRUCTURE.md) for the map of every surface.
