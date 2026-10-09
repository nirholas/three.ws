# Modly and three.ws

[Modly](https://github.com/lightningpixel/modly) is a free, open-source desktop
app by [Lightning Pixel](https://github.com/lightningpixel) that turns images
into 3D models on your own graphics card. It is MIT licensed, and three.ws
builds on it in both directions: three.ws can use the Modly running on your
computer, Modly users get three.ws cloud GPUs as Modly nodes, and several
Modly ideas (the workflow builder, mesh cleanup, the slicer handoff) now live
on the platform for everyone.

This page maps every piece and points to its full docs.

## Which one do I want?

| You have | You want | Use |
|---|---|---|
| Modly installed and a decent GPU | to generate on your own hardware from a browser | [/modly](https://three.ws/modly), or the **Use your GPU** panel in [/forge](https://three.ws/forge) |
| Modly installed, but a small GPU or none | cloud generation, rigging and remeshing inside Modly | the [three.ws Cloud extension](#threews-cloud-inside-modly) |
| Modly making models locally | to put them on a shareable three.ws page | the [Publish node](#publish-to-threews) |
| no Modly, just a browser | to chain steps (prompt or photo, generate, remesh, rig) in one run | [/forge/workflows](https://three.ws/forge/workflows) or [/workbench](https://three.ws/workbench) |
| a finished model | to clean it up or 3D print it | [mesh tools and the slicer handoff](./forge.md#mesh-tools-repair-smooth-decimate) |

## Your GPU from three.ws

Modly runs a local server on `http://localhost:8765` that accepts requests from
web pages. three.ws talks to it directly from your browser through one shared
client, [src/modly-local.js](../src/modly-local.js) (`probeModly`,
`detectModly`, `listModlyModels`, `generateWithModly`, `modlyMeshOp`). Nothing
on your computer is contacted until you press **Connect**, because probing
loopback makes Chrome ask for local network access.

**The /modly page** ([/modly](https://three.ws/modly)) is the hub. It detects
Modly and explains every failure it can hit (not running, the browser blocked
local network access, a custom port), lists the models you have downloaded in
Modly, runs image-to-3D on your GPU with Modly's real progress and cancel, and
applies Modly's own mesh tools with undo. Typed prompts go through a three.ws
concept image first, since Modly's local models take images. The result
downloads as a GLB or saves to your account.

**The Forge lane.** In [/forge](https://three.ws/forge), the photos tab has a
**Use your GPU** panel. After Connect, each Modly model you have downloaded
joins the engine picker marked "Your GPU, free". A run shows Modly's percent
and step text in the timeline, Cancel stops Modly's job, and the finished GLB
is copied to three.ws storage so rigging, optimize, AR and embeds work on it
like on any cloud result. It can be saved to your avatars.

Browser notes: Chrome asks once for local network access; if it was denied,
the panel shows where to re-enable it. Safari blocks an `https` page from
calling `http://localhost`, and the panel says so. Modly takes one image per
run, so with several photos the first one is used.

## three.ws Cloud inside Modly

The [three.ws Cloud extension](../integrations/modly/README.md) adds six nodes
to Modly's workflow editor. They run on three.ws GPUs, so they work on any
laptop, need no weights and no setup, and generation needs no account.

| Node | What it does |
|---|---|
| Image to 3D | A photo to a textured GLB on a free hosted lane (Hunyuan3D, TRELLIS) or, with your own key, Meshy, Tripo, Rodin, Stability or Replicate |
| Text to 3D | A prompt to a GLB, through a reference image (free) or native text-to-3D (your key) |
| Sketch to 3D | A line drawing plus a short description to a GLB |
| Auto-Rig | Adds a Mixamo-compatible humanoid skeleton |
| Remesh | Quad, triangle or low-poly retopology with a texture bake, or simplify, or repair |
| Publish | Saves the mesh to your three.ws account and opens its page |

Nodes chain: Image to 3D into Auto-Rig into Remesh uploads nothing after the
first step, because the extension remembers the three.ws URL of every mesh it
has handled. A mesh made by a local Modly model is uploaded once and reused.

Install it with Modly's **Link local folder** (steps in the
[extension README](../integrations/modly/README.md#install)). One-click install
from GitHub and Modly's trusted badge are described in
[SUBMITTING.md](../integrations/modly/SUBMITTING.md).

Every node uses the same Python client as the Blender add-on and the ComfyUI
nodes, [integrations/_pyclient/three_ws_client.py](../integrations/_pyclient/README.md),
which now also covers GLB upload, auto-rig, remesh and publishing.

## Publish to three.ws

[`integrations/modly/three-ws-publish/`](../integrations/modly/three-ws-publish/README.md)
is a standalone Modly process node that saves the mesh from any Modly node to
your account and outputs the page URL. Use it when the rest of your workflow
runs locally; the Cloud extension's Publish node is the same step at the end of
a three.ws chain. Both take an API key with the `avatars:write` scope from
[three.ws/dashboard/api](https://three.ws/dashboard/api).

## three.ws Forge desktop app

[`apps/forge-desktop/`](../apps/forge-desktop/README.md) is Modly's desktop app
in three.ws colors, with a three.ws account built in: sign in from Settings,
publish a result from the Generate screen, and browse your three.ws library
without leaving the app. The Publish node ships inside it, already signed in.
Downloads are on [/forge-desktop](https://three.ws/forge-desktop).

## Ideas from Modly, built into the platform

- **Workflow builder** at [/forge/workflows](https://three.ws/forge/workflows):
  link a prompt or photo to any live engine, then remesh, rig, segment, restyle
  or make it game-ready, in one run, like Modly's workflow editor but on
  three.ws GPUs.
- **Mesh tools** on every finished model in the Forge and on `/m/:id`: repair,
  Taubin or Laplacian smoothing and decimation in a browser worker, with undo.
  See [Forge: mesh tools](./forge.md#mesh-tools-repair-smooth-decimate).
- **Slicer handoff**: **Open in OrcaSlicer** and **Open in Bambu Studio** send a
  print-ready STL or 3MF (upright, in millimetres, on the bed) from
  `/api/slicer/<id>/model.stl`. See
  [Forge: open in a slicer](./forge.md#open-in-a-3d-printing-slicer) and the
  [API reference](./api-reference.md).

## Developers

| Piece | Where | Tests |
|---|---|---|
| Browser client for a local Modly | [src/modly-local.js](../src/modly-local.js) | `npx vitest run tests/modly-local.test.js` |
| /modly page | [pages/modly.html](../pages/modly.html), [src/modly-page.js](../src/modly-page.js) | |
| Forge lane | [src/forge-modly.js](../src/forge-modly.js), wired in [src/forge.js](../src/forge.js) | |
| Cloud extension | [integrations/modly/three-ws/](../integrations/modly/three-ws/) | `python3 -m unittest discover -s integrations/modly/tests -p 'test_*.py'` |
| Publish node | [integrations/modly/three-ws-publish/](../integrations/modly/three-ws-publish/) | see its README |
| Shared Python client | [integrations/_pyclient/](../integrations/_pyclient/) | `python3 -m unittest discover -s integrations/_pyclient -p 'test_*.py'` |
| Desktop app | [apps/forge-desktop/](../apps/forge-desktop/) | see its README |
| Mesh tools | [src/mesh-ops/](../src/mesh-ops/) | `npx vitest run tests/mesh-ops.test.js` |
| Slicer handoff | [api/slicer/model.js](../api/slicer/model.js), [api/_lib/print/slicer.js](../api/_lib/print/slicer.js), [src/slicer-handoff.js](../src/slicer-handoff.js) | `npx vitest run tests/slicer-handoff.test.js` |

## Credit

Modly is MIT licensed, Copyright (c) 2026 Lightning Pixel. Code adapted from it
carries that notice in its header, and the repository [NOTICE](../NOTICE)
lists every such file.

## Related

- [Forge](./forge.md): the cloud generator these surfaces share
- [Workbench](./workbench.md): a desktop-style workspace in the browser
- [integrations/README.md](../integrations/README.md): Blender, ComfyUI and Modly plugins
- [STRUCTURE.md](../STRUCTURE.md): where every surface lives
