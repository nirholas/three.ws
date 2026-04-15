# Task 06 — Accessories (hat, glasses, backpack)

## Why

Personality surface for under-2-hours work. Slot a hat on the head bone, glasses on the face, backpack on the spine. Works across any Avaturn-generated skeleton because bone names are standard.

## Read first

- [src/animation-manager.js](../../src/animation-manager.js) — bone retargeting
- [src/viewer.js](../../src/viewer.js) — content traversal
- [public/animations/](../../public/animations/) — example GLB structure
- Three.js `SkeletonHelper`, `Object3D.attach`

## Build this

### 1. Accessory library

Static set of GLBs under `public/accessories/`:

```
public/accessories/
  hats/baseball-cap.glb
  hats/beanie.glb
  hats/crown.glb
  hats/witch.glb
  glasses/round.glb
  glasses/sunglasses.glb
  backpacks/adventurer.glb
```

Each GLB is a single root-anchored mesh. No animations, no skeleton. Local-origin.

### 2. Manifest

`public/accessories/index.json`:
```json
{
  "hats":     [ { "id": "baseball-cap", "name": "Cap", "uri": "./hats/baseball-cap.glb", "anchor": "head" } , … ],
  "glasses":  [ { "id": "round", "name": "Round glasses", "uri": "./glasses/round.glb", "anchor": "head", "offset": [0, 0.05, 0.08] } , … ],
  "backpacks":[ { "id": "adventurer", "name": "Adventurer", "uri": "./backpacks/adventurer.glb", "anchor": "spine" } , … ]
}
```

### 3. Anchor resolution

In a new `src/editor/accessories.js`:
```js
export function attachAccessory(agentContent, accessory) {
	// find bone by anchor name (try: HeadTop_End, Head, Neck, Spine2, Spine1, Spine)
	// load accessory GLB
	// parent root node to the bone
	// apply offset + rotation from the accessory manifest
	// return a handle so detach works
}
export function detachAccessory(handle) { /* remove from parent, dispose */ }
```

### 4. Patch shape

`agent_identities.meta.edits.accessories`:
```json
{ "hats": "baseball-cap", "glasses": null, "backpacks": "adventurer" }
```

Null or missing = none. One accessory per category.

### 5. `/agent/:id/edit` tab "Accessories"

- Three sections: Hats / Glasses / Backpacks.
- Each shows a grid of thumbnail cards.
- Click applies instantly on the preview + PATCH.

### 6. Apply on load

After model load, read `meta.edits.accessories` and call `attachAccessory` per set item. Idempotent.

## Don't do this

- Do not upload custom accessory GLBs (scope creep, security).
- Do not try to clip against the body mesh — offset tuning is enough.
- Do not animate accessories separately — they inherit the body animation via the bone parent.

## Acceptance

- [ ] Pick a hat → appears on the head and follows idle animation.
- [ ] Pick glasses → stays on the face during talk animation.
- [ ] Backpack sticks to spine during walk/wave.
- [ ] Embed reflects choices.
- [ ] `npm run build` passes.

## Reporting

- Screenshots of each category
- Bone-resolution log (what name matched) for 2 different avatars
- Any seams or z-fighting noticed (document, do not fix — offsets can be tuned later)
