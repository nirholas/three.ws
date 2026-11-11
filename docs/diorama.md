# Diorama: speak a little world into being

Diorama turns one sentence into a tiny, explorable 3D world. You describe a scene, an AI set designer decomposes it into a placed set of single objects, and each object is forged into a real textured GLB and dropped into place, live, as it arrives. The finished world sits on a small floating island you can orbit, view in AR, save to a public gallery with its own permalink, and export as a single merged GLB that opens cleanly in Scene Studio.

Page: [/diorama](https://three.ws/diorama) · API: `/api/diorama`

## Why it exists

Forge makes one object at a time. But a world is a composition: a campfire and a tent and three pine trees, arranged on the ground, lit for a mood. Doing that by hand means forging each piece, importing them into a scene editor, and placing them one by one. Diorama collapses that into a sentence. It is the difference between a modeling tool and a director's chair: you say what you want to see, and the platform composes, generates, and assembles it in front of you. Every object is a real mesh (no billboards, no fakes), so the result is genuine geometry you can walk around, share, and take into any glTF tool.

## How it works

Diorama is a four-step pipeline (`api/diorama.js` plus `src/diorama/`), and each step is real.

1. **Compose.** `POST /api/diorama {action:'compose', prompt}` sends your sentence to the platform's free-first LLM chain (`llmComplete`) with a 3D-set-designer system prompt. The model returns a strict JSON plan: a 2-to-4-word title, a mood (`dawn`/`day`/`dusk`/`night`), a ground type (`grass`/`sand`/`snow`/`stone`/`water`/`meadow`/`void`), an island shape (`round`/`craggy`/`plateau`), a color palette (sky gradient, ground, fog, accent), and a placed list of objects. Each object is exactly one physical thing (a single tree, a single tent, never a scene and never "and"), with a one-line forge prompt (subject plus dominant material and color), an `(x, 0, z)` position spread across the island with spacing enforced, a scale, and a Y rotation. Objects come back with `status:'pending'` and no meshes.

2. **Forge each object.** The browser walks the plan and calls `/api/forge` for every object, on the free lane, watching each one turn from `pending` to `forging` to `ready` (or `failed`, with an in-place retry). The renderer (`src/diorama/renderer.js`) materializes each mesh into the scene the moment it arrives, so the world assembles progressively in front of you rather than appearing all at once.

3. **Save and share.** `POST /api/diorama {action:'save', diorama}` persists a fully-forged world, returns an `{id, url}` permalink, opens the share sheet, refreshes the gallery, and rewrites the page URL to the new permalink. A signed-in creator's world links to their public portfolio; anonymous saves fall back to a plain handle.

4. **Export.** `POST /api/diorama {action:'export', diorama}` merges the world's objects, ground, and lights into one GLB (`api/_lib/scene-graph-compose.js`) with named, selectable nodes, uploads it, and hands back a `glbUrl` plus a `sceneStudioUrl` so it opens directly in Scene Studio ([/scene](https://three.ws/scene)) or any glTF viewer.

A headless one-shot, `POST /api/diorama {action:'build', prompt}`, runs the whole flow server-side (compose, forge every object on the free lane, export the merged GLB) for callers with no browser to drive the progressive client, such as MCP tools and agents.

Reads: `GET /api/diorama?id=<uuid>` loads a saved world (a deep link renders it read-only and offers a remix), and `GET /api/diorama?list=recent|featured&limit=<n>` returns gallery cards. The gallery renders each card as live geometry through `<model-viewer>`, not a flat thumbnail.

There are no mocks: if the LLM chain is unreachable, the compose route returns a clean 503 and the page shows a designed retry state instead of fabricating a world.

## From a photo

Diorama can also rebuild a scene you photographed. Click **From a photo** next to the prompt box, or drop or paste an image onto the page. The pipeline is the same four steps, with a vision reader in place of the sentence composer:

1. **Read the photo.** The browser downscales the photo to 1600 px on its longest side, uploads it to object storage (`/api/forge-upload`), and calls `POST /api/diorama {action:'compose-photo', imageUrl}`. When storage is unavailable it sends the photo inline instead (`imageBase64`, capped at 700 KB decoded). The server (`api/_lib/diorama-photo.js`) asks the vision chain in `api/_lib/vision.js` to read the photo as a set designer would. For each separable object it returns a label, a forge prompt, a tight bounding box, its distance and real size, what it rests on, and whether it is occluded. The free OpenRouter vision routes lead for this caller, then the NIM lane, Vertex Gemini, and the paid backstop. `src/diorama/photo-layout.js` turns that report into a placed plan: horizontal position comes from the box centre and distance, scale from the real size, and stacked objects (a laptop on a desk) keep a `supportId`.

2. **Forge from the crops.** Every fully visible object is forged image to 3D from its own crop of the photo, so the mesh keeps the real thing's shape and colour. Occluded or tiny objects, and any crop the image lane rejects, fall back to the text lane with the object's prompt. Each chip shows a small picture glyph when its mesh came from the photo. The hover hint says whether the piece was forged from its crop or from its description.

3. **Assemble.** A photo inset sits in the corner with a live box per object (dashed while forging, solid when ready, red when failed). Hovering or focusing a chip highlights its box, and the reverse works too. An object resting on another is seated on the supporter's mesh top once both have forged. The camera frames the forged objects rather than the whole island, so the scene reads at the size it had in the photo.

4. **Save and share.** A photo world saves like any other. It keeps a link to its photo (`sourceImage`) and to each crop (`refImage`), but only when they live on this deployment's own storage. Links to third-party images are stripped on save, so a public world never republishes an arbitrary URL. A deep link to a saved photo world shows the photo inset again.

Errors are typed: `400 invalid_image` for a bad URL or payload, `422 photo_unreadable` when no separate objects stand out (the page asks for a clearer shot with a few distinct things in view), and `503 composer_unavailable` when no vision lane answers.

```bash
curl -s -X POST https://three.ws/api/diorama \
  -H 'content-type: application/json' \
  -d '{"action":"compose-photo","imageUrl":"https://example.com/my-desk.jpg"}'
```

## Walkthrough

1. Open [/diorama](https://three.ws/diorama).
2. Type a sentence: `a lighthouse on a rocky islet at dusk`, or `a cozy campsite in a pine clearing`.
3. Watch the plan appear as a row of per-object status chips (pending, forging, ready). The island, ground, and mood render immediately from the palette.
4. Watch each object drop into place as its mesh finishes forging. A failed object gets a one-tap retry.
5. Orbit the finished world. When at least one real mesh is present, the world actions unlock: remix, save, AR (on supported devices), and download.
6. Save to get a permalink and a gallery slot, or export to open the merged GLB in Scene Studio.

## Examples

Compose a plan, then drive the forge yourself, or let the server build the whole thing.

```bash
# 1) Compose: sentence -> placed plan of single-object forge prompts.
curl -X POST 'https://three.ws/api/diorama' \
  -H 'content-type: application/json' \
  -d '{"action":"compose","prompt":"a lighthouse on a rocky islet at dusk"}'

# 2) Headless one-shot: compose + forge every object + export a merged GLB.
curl -X POST 'https://three.ws/api/diorama' \
  -H 'content-type: application/json' \
  -d '{"action":"build","prompt":"a cozy campsite in a pine clearing"}'

# 3) Load a saved world by id.
curl 'https://three.ws/api/diorama?id=<uuid>'

# 4) Browse the public gallery.
curl 'https://three.ws/api/diorama?list=featured&limit=12'
```

The compose response shape (abridged). The plan always arrives under a
`diorama` key, and every read (`?id=`, the save and build actions) returns that
same object, so one renderer handles all of them. `id` and `createdAt` are empty
until the world is saved:

```json
{
  "diorama": {
    "id": "",
    "prompt": "a lighthouse on a rocky islet at dusk",
    "title": "Lonely Beacon Watch",
    "mood": "dusk",
    "ground": "stone",
    "island": "craggy",
    "palette": { "sky": ["#2e3a59", "#d67850"], "ground": "#4a4a4a", "fog": "#332d40", "accent": "#ffcc00" },
    "objects": [
      { "id": "obj-0", "label": "lighthouse", "prompt": "tall lighthouse made of weathered white brick with a glass lantern room", "position": [0, 0, 0], "scale": 2.2, "rotationY": 0, "status": "pending", "glbUrl": null },
      { "id": "obj-1", "label": "boulder", "prompt": "jagged grey granite boulder with lichen patches", "position": [3.5, 0, 2], "scale": 1.2, "rotationY": 0.5, "status": "pending", "glbUrl": null }
    ],
    "author": null,
    "createdAt": "",
    "views": 0,
    "featured": false
  }
}
```

## Playing a world

A world can carry a small game. When the prompt names a goal ("collect the three lanterns", "reach the lighthouse", "survive 45 seconds and keep clear of the dragon"), the composer adds a `game` block that points at some of the placed objects by index. The server maps those to object ids and the schema normalizes the block (`normalizeGame` in `src/diorama/schema.js`), so a bad plan degrades to a world with no goal, never a broken one.

| Goal | Rule |
| --- | --- |
| `collect` | Walk into `count` of the target objects. Each one disappears when picked up. Optional timer. |
| `reach` | Walk to the first target. Optional timer. |
| `survive` | Targets are hazards. Touching one loses; outlasting the timer wins. A timer is required (10 to 600 seconds). |

The world page shows **Play this world** for any world with a goal. It stays disabled, with the reason as its tooltip, until the goal objects have forged (`playability()` in `game-rules.js`). Decorations that failed to forge do not block play. Controls: WASD or arrow keys, a drag pad on touch screens, or tap the ground. Escape exits. The walker is your own walk avatar, loaded through walk-sdk; if it fails to load you get a Retry card.

The game block is stored inside the saved world document, so no migration is needed. **Share as a game** (in the share sheet after saving) copies the permalink with `?play=1`, which opens the world straight into its game; the X post carries the objective text. Opening a `?play=1` link for a world with no goal or unforged goal objects shows the normal world view.

## States and limits

- **Object count** is bounded (the plan enforces a minimum and maximum), and objects are spaced so they never stack.
- **Compose failure**: a clean 503 and a designed retry state, never a fabricated world.
- **Per-object status**: pending, forging, ready, failed (with in-place retry). One failed object does not block the rest.
- **Save/export** need object storage configured; export returns 503 with a clear message when it is not.
- **AR and download** appear only once at least one real mesh has forged.
- **Deep links** render a saved world read-only and offer a remix, so a shared permalink is stable.
- Prompt length is capped; reads are rate-limited per client IP.

## Related

- [Forge](./forge.md) is the single-object generator every diorama object is forged on.
- [Image to 3D](./image-to-3d.md) is the lane each photo crop is forged on; [AR](./ar.md) for viewing worlds in augmented reality.
- Pages: [/scene](https://three.ws/scene) (Scene Studio, where an exported diorama opens), [/gallery](https://three.ws/gallery), [/create](https://three.ws/create).
