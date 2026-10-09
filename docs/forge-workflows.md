# Forge Workflows: chain 3D tools into one run

Forge Workflows is a visual node editor for the Forge toolchain. You place nodes on a canvas (a prompt or a photo, a generator, processing steps such as Auto-rig or Remesh, and an output such as Export), wire them together, and press **Run**. Every node calls the same production endpoint the rest of three.ws uses, so a workflow is a repeatable recipe for real work, not a simulation.

Page: [/forge/workflows](https://three.ws/forge/workflows)

## Why it exists

[Forge](./forge.md) is one box: type or drop something in, get a model out. Creators who make game props, rigged characters or printable parts repeat the same three or four steps after that, by hand, every time. Forge Workflows turns those steps into a graph you build once, save as a file, share, and run again on a new prompt or a batch of photos. A failed step does not throw away the rest: re-run from the node that failed and every finished step before it is reused.

[Workbench](./workbench.md) covers a related need with a fixed photo pipeline and a large viewport for in-browser mesh edits. Forge Workflows is the free-form graph: any order, branches, batches, and several outputs from one run.

## Quick start

1. Open [/forge/workflows](https://three.ws/forge/workflows). An empty canvas offers four templates.
2. Pick **Text to rigged character**. Five nodes appear: Text prompt, Generate 3D, Auto-rig, Preview and Export.
3. Edit the prompt in the inspector on the right, or keep the default.
4. Press **Run** or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>Cmd</kbd>+<kbd>Enter</kbd> on a Mac). Each card shows its state and live progress. When the run finishes, Preview shows the rigged model and Export downloads `rigged-character.glb`.

You can also link straight to a template: `/forge/workflows?template=text-rig-export`.

## Templates

| Template | Id | Chain | Needs |
|---|---|---|---|
| Photo to 3D | `image-preview` | Image → Generate 3D → Preview | A photo |
| Text to rigged character | `text-rig-export` | Text prompt → Generate 3D → Auto-rig → Preview and Export | A prompt |
| Batch photos to library | `batch-save` | For Each (photos) → Generate 3D → Preview and Save | Photos and a sign-in |
| Photo to game asset | `image-gameready` | Image → Generate 3D → Remesh → Game-ready → Preview and Export | A photo and $THREE |

A template is a starting point. Loading one replaces the canvas (undo brings the previous graph back), and every node stays editable.

## Nodes

Ports are typed: **text**, **image** and **mesh**. A link can only join an output to an input of the same type, and the editor highlights the inputs that fit while you drag.

| Node | Takes | Gives | Calls | What it does |
|---|---|---|---|---|
| Text prompt | | text | Nothing (local) | A prompt of up to 1000 characters. |
| Image | | image | `POST /api/forge-upload` | One PNG, JPEG or WebP photo up to 8 MB, uploaded once to three.ws storage so the workflow file stays portable. |
| Load 3D | | mesh | `POST /api/scene-glb-upload` when you upload | A public https `.glb` link, or a GLB file you upload (up to 200 MB). |
| For Each | | text or image | Nothing (local) | Repeats everything downstream once per item: up to 12 photos or 50 prompts (one per line). |
| Generate 3D | text, or image plus an optional text hint | mesh | `POST /api/forge`, then `GET /api/forge?job=` and `?progress=` | Text or photo to a textured GLB. The **Engine** list comes from the live catalog (`/api/forge?catalog=1`) with health from `/api/forge?health=1`; **Auto** picks the best free engine. **Quality** is Draft, Standard, or High for $THREE holders. In photo mode the list also offers **Your GPU (Modly)**. |
| Remesh | mesh | mesh | `POST /api/forge-remesh` | Repair, simplify or convert to triangles, quads or low-poly at a target face count. |
| Auto-rig | mesh | mesh | `POST /api/forge?action=rig` | Adds a humanoid skeleton and skin weights. |
| Segment | mesh | mesh | `POST /api/forge-segment` | Splits the model into parts (auto, connected pieces or sharp creases). |
| Stylize | mesh | mesh | `POST /api/forge-stylize` | Voxel, brick, Voronoi or low-poly restyle. |
| Game-ready | mesh | mesh | `POST /api/forge-gameready` | Retopology to a poly budget and a texture bake, with GLB and FBX output. |
| Preview | mesh | | Nothing (local) | An inline 3D viewer on the card. Generate 3D and Auto-rig cards also link to the model page when the engine saved one. |
| Export | mesh | | Nothing for GLB; the browser converts STL, OBJ and PLY | Downloads the model as GLB, FBX (from Game-ready), STL, OBJ or PLY. |
| Save | mesh | | `POST /api/avatars/from-forge` or `POST /api/creations` | Saves to your library (sign-in required) or publishes to the public creations gallery. |

Processing workers download the model themselves, so a model that only exists in the browser (made on your GPU, or behind an over-long link) is uploaded to three.ws storage first. The card shows "Uploading the model" while that happens.

### Your GPU (Modly)

[Modly](./modly.md) is a free desktop app that runs open image-to-3D models on your own graphics card. Pick **Your GPU (Modly)** as the Generate 3D engine and press **Connect Modly** in the inspector. The page only contacts `localhost` after that click, so the browser's local network permission prompt appears when you expect it, never on page load. The inspector then lists the models installed in Modly. A Modly step costs nothing and never leaves your computer until a later step needs the model on a server.

## Running

### Preflight

Before anything runs, the graph is checked and every problem is listed on the node it belongs to, in plain words:

- a required input with nothing connected ("Auto-rig needs a mesh connected to Model");
- a link between ports of different types;
- a loop of links (repeat steps with For Each instead);
- a node with a missing setting, such as an empty prompt or no photo;
- a For Each nested inside another, or a node fed by two For Each nodes;
- warnings that do not block a run, such as a For Each with nothing after it.

**Run** stays disabled while there are blocking problems. Click an issue to jump to its node.

### States

Every node card carries one of these states:

| State | Meaning |
|---|---|
| Pending | Waiting for the steps before it. |
| Running | Working now. The bar shows real progress from the server; when the server only knows an estimate, the percentage is marked with `~`, and once a job passes its estimate the card says "taking longer than usual" instead of guessing. |
| Done | Finished. "Served from cache" means the result was reused from an earlier run. |
| Failed | The step failed. The card shows why and what to do: retry, sign in, wait out a rate limit, or open the status page. |
| Skipped | Not run, because a step before it failed. |
| Cancelled | You pressed Cancel (or <kbd>Esc</kbd>) while it was pending or running. |

Branches are independent: if Auto-rig fails, an Export wired straight to Generate 3D still runs.

### Re-running and the cache

Each finished step is cached for as long as the tab is open, keyed by its settings and everything upstream of it.

- **Run** reuses every step whose inputs and settings have not changed, so editing only the Export file name and pressing Run does not regenerate the model.
- **Retry** on a failed card re-runs from that node and reuses everything before it.
- **Run fresh** ignores the cache and runs every step again.
- Changing a setting invalidates that node and everything downstream of it.

### For Each

For Each follows the loop semantics of Modly's workflow runner. Everything downstream of a For Each runs once per item, in order, and each item's chain is independent: if item 2 of 5 fails, items 3 to 5 still run, the card shows `3/5`-style counts, and Retry re-runs only the item that failed. Steps that are not downstream of the loop run once. Loops cannot be nested.

## Saving and sharing

- **Autosave.** The current graph is saved in this browser as you edit (`localStorage`, key `forge-workflows:v1:current`). If storage is blocked, the editor still works and the header says the graph is not being saved.
- **Export** downloads the graph as a `.json` file. **Import** loads one. Run results are not part of the file.

The file format:

```json
{
  "kind": "three.ws/forge-workflow",
  "version": 1,
  "name": "Text to rigged character",
  "nodes": [
    { "id": "t_prompt", "type": "prompt", "x": 40, "y": 120, "params": { "text": "a friendly cartoon robot" } },
    { "id": "t_gen", "type": "generate", "x": 320, "y": 120, "params": { "mode": "text", "engine": "auto", "tier": "draft" } },
    { "id": "t_exp", "type": "export", "x": 600, "y": 120, "params": { "format": "glb", "filename": "robot" } }
  ],
  "edges": [
    { "id": "e1", "from": { "node": "t_prompt", "port": "text" }, "to": { "node": "t_gen", "port": "prompt" } },
    { "id": "e2", "from": { "node": "t_gen", "port": "mesh" }, "to": { "node": "t_exp", "port": "mesh" } }
  ]
}
```

Import validates the file: it must have this `kind`, a `version` no newer than the page understands, unique node ids, known node types, and at most 200 nodes and 600 links. Links to nodes that are not in the file are dropped, and preflight flags any link to a port a node does not have. Settings missing from a node take their defaults, so an older file keeps loading.

## Keyboard

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd> | Run the workflow |
| <kbd>Esc</kbd> | Cancel a run, or clear the selection |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Remove the selected nodes or link |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>D</kbd> | Duplicate the selection |
| Arrow keys | Nudge the selected nodes (hold <kbd>Shift</kbd> for bigger steps) |
| <kbd>Ctrl</kbd>+scroll | Zoom at the pointer |

Nodes are reachable with <kbd>Tab</kbd>, and the palette works by click as well as by drag.

## On a phone

At 760px wide or less the canvas gives way to a read-only list of the steps in run order, with a **Workflow** picker at the top for switching templates. Each step shows its state and progress, the inputs a run needs (the prompt, the photos, the For Each list, a Load 3D link) stay editable, and a **Run workflow** button sits at the bottom. Open a template link such as `/forge/workflows?template=image-preview` on a phone to run it with your camera roll. Building and rewiring graphs needs a wider screen.

## Lineage

The For Each loop semantics, the typed-port model and the idea of a local-GPU generator node are adapted from [Modly](https://github.com/lightningpixel/modly) (MIT License, Copyright (c) 2026 Lightning Pixel). The modules that carry that design state the attribution in their headers. The editor itself is written for three.ws in plain JavaScript with an SVG link layer. Existing node-editor libraries were evaluated first: Drawflow has had no release since 2024 and has no typed sockets or undo, Rete v2 needs a framework renderer plugin, LiteGraph draws to a canvas with no accessibility tree, and BaklavaJS is built on Vue. None fit a vanilla Vite page that must be keyboard and screen-reader friendly.

## Code map

| File | Role |
|---|---|
| `pages/forge-workflows.html` | The page shell. |
| `src/forge-workflows/main.js` | Boot, toolbar, autosave, keyboard, phone layout. |
| `src/forge-workflows/graph.js` | Pure graph model: preflight, topological order, For Each plan, serialization. |
| `src/forge-workflows/runner.js` | Scheduler: states, progress, cancel, cache, re-run from a node. |
| `src/forge-workflows/node-types.js` | The node registry (ports, settings, checks). |
| `src/forge-workflows/executors.js` | The network side of each node. |
| `src/forge-workflows/editor.js` | Canvas, nodes, links, pan and zoom. |
| `src/forge-workflows/inspector.js` | The settings panel. |
| `src/forge-workflows/results.js` | Preview viewer and result links. |
| `src/forge-workflows/templates.js` | The four templates. |
| `tests/forge-workflows-graph.test.js`, `tests/forge-workflows-runner.test.js` | Unit tests for the graph and the runner. |

Related: [Forge](./forge.md), [Workbench](./workbench.md), [Modly](./modly.md), [How Forge works](./how-forge-works.md).
