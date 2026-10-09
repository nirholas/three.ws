# three.ws for Modly

[Modly](https://github.com/lightningpixel/modly) is a free, open-source desktop
app (MIT, by [Lightning Pixel](https://github.com/lightningpixel)) that turns
images into 3D models on your own graphics card, with a node-based workflow
editor. This folder holds the two Modly extensions three.ws ships:

| Extension | Folder | Type | What it adds to Modly |
|---|---|---|---|
| three.ws Cloud | [`three-ws/`](three-ws/) | model | Six nodes that run on three.ws GPUs: image, text and sketch to 3D, auto-rig, remesh, publish. No GPU, no weights, no setup. |
| Publish to three.ws | [`three-ws-publish/`](three-ws-publish/) | process | One node that saves any mesh, from any generator, to your three.ws account. See its [README](three-ws-publish/README.md). |

The other direction (three.ws using a Modly install) lives outside this folder;
[docs/modly.md](../../docs/modly.md) maps every Modly integration on the
platform.

## three.ws Cloud: the nodes

Every node talks to the public Forge API (`https://three.ws/api/forge` and
friends) through the shared, stdlib-only
[`three_ws_client.py`](../_pyclient/three_ws_client.py). Generation is free and
needs no account.

| Node | Input | Parameters | Output |
|---|---|---|---|
| **three.ws Image to 3D** | image | Engine (Auto, Hunyuan3D, TRELLIS on NVIDIA, TRELLIS self-host, TRELLIS.2, Hugging Face Spaces, or Meshy, Tripo, Rodin, Stability, Replicate with your key), Quality, optional prompt hint, provider key | GLB |
| **three.ws Text to 3D** | text | Route (reference image then 3D, free; or native text-to-3D with your key), Engine, Quality, aspect ratio, provider key | GLB |
| **three.ws Sketch to 3D** | image + text | What the sketch shows (required unless a text node is wired in), Quality | GLB |
| **three.ws Auto-Rig** | mesh | none | GLB with a Mixamo-compatible humanoid skeleton |
| **three.ws Remesh** | mesh | Topology (quads, triangles, low poly), Operation (retopology with texture bake, simplify, repair), target faces, texture size | GLB |
| **three.ws Publish** | mesh | API key, name, visibility, open the page when done | the same mesh, plus a three.ws page |

Behavior worth knowing:

- **Engines are checked against the live catalog.** If the engine you picked is
  not serving right now, the node falls back to the server's default lane and
  says so in the progress line instead of failing.
- **Chains do not re-upload.** Every GLB the extension downloads is remembered
  with its three.ws URL (keyed by the file's SHA-256). Wire Image to 3D into
  Auto-Rig into Remesh and only the first step sends anything; the rest hand
  the existing URL to the next job. A mesh made locally in Modly is uploaded
  once, then reused.
- **Progress is real.** Each node reports the Forge job's status and elapsed
  seconds; Cancel in Modly stops polling and the node ends as cancelled.
- **Outputs land in your Modly workspace** like any other node's, named
  `<time>_<id>_three-ws-<node>.glb`, so Modly's viewer, export and optimize
  tools work on them.

### Install

The extension lives inside the three.ws repository, so link it as a local
folder (Modly's **Install from GitHub** button needs `manifest.json` at a
repository's root; see [SUBMITTING.md](SUBMITTING.md) for that route).

1. Copy the folder somewhere permanent:

   ```bash
   git clone --depth 1 https://github.com/nirholas/three.ws /tmp/three.ws
   cp -r /tmp/three.ws/integrations/modly/three-ws ~/modly-three-ws
   ```

2. In Modly open **Models**, click **Link local folder**, and pick
   `~/modly-three-ws`. Modly links it in place, so keep the folder.
3. The six nodes appear in the workflow editor under **three.ws Cloud**. There
   are no weights to download; the extension reports itself ready.

Instead of linking you can copy the folder into Modly's extensions directory
(`<Modly user data>/extensions/three-ws`) and restart Modly.

### Configuration

All optional. Set them in the environment Modly starts from.

| Variable | Used by | Meaning |
|---|---|---|
| `THREE_WS_PROVIDER_KEY` | Image, Text | Your own Meshy, Tripo, Rodin, Stability or Replicate key, for the engines marked "your key". The node's field wins over the variable. It travels only as the `x-forge-provider-key` header. |
| `THREE_WS_API_KEY` | Publish | A three.ws API key with the `avatars:write` scope, from [three.ws/dashboard/api](https://three.ws/dashboard/api). Prefer this over the node field so the key never ends up in a shared workflow. |
| `THREE_WS_BASE_URL` | all | Point the extension at another three.ws deployment. Default `https://three.ws`. |

The extension keeps one small file next to Modly's models folder,
`three-ws-state.json`: an anonymous client handle (so Forge rate limits and job
ownership stay stable across restarts) and the URL index for chain reuse,
capped at the 500 most recent meshes.

## Tests

No live network: the tests run a real in-process HTTP server that speaks the
Forge contract, and load `generator.py` by file path the way Modly does, against
a copy of Modly's own `BaseGenerator`
([`tests/host/services/generators/base.py`](tests/host/services/generators/base.py)).

```bash
python3 -m unittest discover -s integrations/modly/tests -p 'test_*.py'
```

`three_ws_client.py` in each extension folder is a byte-identical copy of the
canonical client; `integrations/_pyclient/test_no_drift.py` fails if it
drifts. After editing the canonical client:

```bash
cp integrations/_pyclient/three_ws_client.py integrations/modly/three-ws/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/modly/three-ws-publish/three_ws_client.py
```

## Licenses

The extensions are Apache-2.0 like the rest of three.ws ([`three-ws/LICENSE`](three-ws/LICENSE)).
Modly itself is MIT, Copyright (c) 2026 Lightning Pixel; the test host's
`base.py` is a copy of Modly's and carries that attribution.
