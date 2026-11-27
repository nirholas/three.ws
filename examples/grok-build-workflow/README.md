# Grok Build + three.ws: from a sentence to a GLB in your three.js scene

A walk-through of the three.ws plugin for [Grok Build](https://github.com/xai-org/grok-build),
xAI's coding agent for the terminal. It covers installing the plugin, taking the
guided tour, making a model from one sentence, and loading the result into a
three.js scene. The [`starter/`](starter/) folder is that scene: a small Vite +
three.js page that loads any GLB three.ws returns.

The plugin lives in this repository at
[`integrations/grok/three-ws`](../../integrations/grok/three-ws/). It brings one
MCP server, five commands, one agent and six skills, and nothing in it spends
money.

## Prerequisites

- Grok Build installed and signed in to your xAI account (see the
  [Grok Build README](https://github.com/xai-org/grok-build)). For scripts and
  CI, `XAI_API_KEY` in the environment signs it in without a browser.
- A free three.ws account to make or rig a model. The sign-in in step 2 can
  create one. Catalog search, rendering and embed code need no account.
- Node 22 or newer for the starter.

## 1. Install the plugin

```bash
git clone --depth 1 https://github.com/nirholas/three.ws three.ws-src
grok plugin install ./three.ws-src/integrations/grok/three-ws --trust

grok plugin details three-ws   # one MCP server, 5 commands, 1 agent, 6 skills
```

Once the plugin is listed in xAI's marketplace, `grok plugin install three-ws --trust`
does the same. Without `--trust`, Grok Build shows the plugin's source and stops.

## 2. Sign in

Start `grok`, type `/mcps`, select `three-ws` and press `i`. Your browser opens
the three.ws sign-in, Grok Build stores the token, and you paste nothing.

For a headless machine, use an API key from
[three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) instead. Keep
the single quotes, so the key is read from your environment and never written
into Grok Build's config:

```bash
export THREE_WS_API_KEY=...
grok mcp add --transport http three-ws https://three.ws/api/mcp-studio --header 'Authorization: Bearer ${THREE_WS_API_KEY}'
```

## 3. Take the tour

```text
/three-ws-tour
```

Grok walks through the plugin one step at a time and asks before each next step:

1. It checks the connection.
2. It searches the catalog for "chair" with `search_catalog`.
3. It makes a model from a sentence with `forge_free`.
4. It makes a rigged avatar with `forge_avatar`.
5. It renders the result with `look_at_model` to check it.
6. It writes embed code with `/embed`.

Every link the tools return is printed in the chat.

## 4. Make a model

```text
/make-3d a brass desk lamp
```

`/make-3d` looks in the free catalog first, so an existing asset comes back
instantly. If none fits, it calls `forge_free`, polls the job, renders the GLB
to check it, and prints four things:

- the GLB URL
- the viewer link
- a poster image
- embed HTML

A generation on the free lane usually takes one to three minutes. For a model
reviewed like an art director would, ask for the agent by name: "use the
3d-art-director agent to make a brass desk lamp". It renders four views,
refines once and keeps the better version.

Two related commands:

- `/rig <glb url>` turns a humanoid GLB into a rigged, animation-ready one.
- `/three-ws-init` writes a short "3D assets" section into your project's
  `AGENTS.md`, so every later Grok Build session knows how to find, make and
  load GLBs here.

## 5. Put the GLB in a three.js scene

```bash
cd examples/grok-build-workflow/starter
npm ci
npm run dev        # http://localhost:3277
```

Open `http://localhost:3277/?src=<the GLB URL Grok printed>`, or paste the URL
into the form. Without one, the page loads a CC0 chair from the catalog, the same
search the tour starts with.

`main.js` is the part to copy into your own project:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync(glbUrl);
scene.add(gltf.scene);
```

The meshopt decoder matters. three.ws avatars ship meshopt-compressed
(`EXT_meshopt_compression`), and a loader without the decoder rejects them. The
starter also does four things for you:

- stands the model on a shadow-catching floor
- frames the camera to the model's bounding box at any size or aspect (`fit.js`)
- lights it with three.js's `RoomEnvironment`
- plays the first animation clip if the GLB has one

Every URL three.ws returns allows cross-origin reads, so you can load it
straight from the CDN. To ship a model with your app, download it into your
`public/` folder instead.

`npm run build` writes a static `dist/` you can host anywhere. `npm test` runs
the framing and URL tests.

## Sample output

A real Grok Build turn with the plugin installed, captured 2026-11-27 with Grok
Build 1.0.92 run headless on an xAI API key (`XAI_API_KEY`, which xAI documents
for scripts and CI). Asked to "find a wooden chair in the three.ws catalog and
show me its viewer link", Grok read the plugin's `find-3d-assets` skill and made
this call through the plugin's MCP server:

```text
{"type":"tool_call","toolName":"use_tool","rawInput":{"tool_name":"three-ws__search_catalog","tool_input":{"q":"wooden chair","kind":"object","limit":5}}}

10 matches for "wooden chair" (showing 5 from offset 0):
- `object:painted_wooden_chair_01` | Painted Wooden Chair 01 | CC0 | chair, wood, painted, farmhouse
- `object:painted_wooden_chair_02` | Painted Wooden Chair 02 | CC0 | old, wooden, vintage, antique
- `object:WoodenChair_01` | Wooden Chair 01 | CC0 | wood, prop, vintage, furniture
```

It answered with Wooden Chair 01 and its viewer link. The commands, the whole
reply, the cost and a second run against production are in the
[plugin README](../../integrations/grok/three-ws/README.md#sample-run).

The tour's step 2 calls `search_catalog`. This is the call it makes, sent
straight to the studio server on 2026-11-20 (1,306 matches, top three):

```text
Arm Chair 01          object  CC0  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
Bar Chair Round 01    object  CC0  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
Barber Shop Chair 01  object  CC0  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
```

A `forge_free` generation on the free lane through the same server, the call
behind step 3 and `/make-3d`:

```text
prop     a chrome lunar lander with gold foil legs
job      pending (submitting), checking again in 15s
job      pending (running), checking again in 20s
job      pending (running), checking again in 5s
glb      https://three.ws/cdn/forge/anon/8b9ba6ce-4f92-4273-94f4-68f9aeca93f2.glb  (made in 106s)
```

The starter loading that GLB, then a three.ws avatar (meshopt-compressed), in
Chromium:

```text
$ npm run dev
  VITE v8.3.8  ready in 1770 ms
  ➜  Local:   http://localhost:3277/

?src=https://three.ws/cdn/forge/anon/8b9ba6ce-4f92-4273-94f4-68f9aeca93f2.glb
  Loaded 8b9ba6ce-4f92-4273-94f4-68f9aeca93f2.glb. Drag to orbit, scroll to zoom.
?src=https://three.ws/avatars/default.glb
  Loaded default.glb. Drag to orbit, scroll to zoom.
console: clean
```

The starter's tests and build, captured 2026-11-27 from a fresh copy of the
folder:

```text
$ npm test
✔ a taller model needs the camera further back (1.99843ms)
✔ a narrow viewport backs the camera off for a wide model (0.338091ms)
✔ the distance scales with the model, so any unit works (0.35275ms)
✔ only https GLB URLs load (http too, on localhost) (0.49494ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0

$ npm run build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/index.html                   0.94 kB │ gzip:   0.53 kB
dist/assets/index-B-toSq9g.css    1.67 kB │ gzip:   0.79 kB
dist/assets/index-CUaUA3ep.js   686.12 kB │ gzip: 172.65 kB
✓ built in 621ms
```

## Cost

- **three.ws:** free. Catalog search, rendering and embed code need no account,
  and making or rigging a model runs on the free lane with a free account. No
  tool in the plugin bills or spends.
- **xAI:** Grok Build uses your xAI account's Grok usage, a few thousand tokens
  per command. The plugin adds no charge.
- **Starter:** free. The two dependencies are `three` and `vite`, both MIT.
