# Avatar Parameter Model v0.1

**Status:** partial (morphs, colors, layers, garments, accessories, proportions and free-sculpt deltas are live; texture layers are live; animation identity is live).

The parameter model is the serialized description of a three.ws avatar's body: one JSON document that says what the character *is*, independent of any particular GLB. It is what saves, what re-opens in the editor, what the server bakes, and what a fork or a share link carries.

The document is stored on `avatars.appearance` and is the single input to both the client-side live preview and the server-side bake. Producers and consumers of it MUST treat it as the contract described here.

## Why a parameter document and not a mesh

An avatar could be stored as its baked GLB alone. That is what a scan-based pipeline does, and it is why a scanned head is not editable afterwards: the parameters that produced it are gone.

Every three.ws avatar keeps its parameters. The GLB is a *render* of the document, regenerable at any time. That is what makes the whole editor composable: a face captured from a photo, a body sculpted with sliders, and a garment generated from a prompt all resolve into fields of the same record, so all three remain editable after the fact and any one of them can be changed without disturbing the others.

## Document

```json
{
  "outfit": "preset-id",
  "accessories": ["preset-id", "..."],
  "morphs": { "noseWider": 0.3, "earPointedLeft": 0.8 },
  "proportions": { "legLength": 1.06, "shoulderWidth": 0.94 },
  "sculpt": { "version": 1, "meshes": { "Body": { "count": 812, "vertexCount": 14517, "scale": 3.1e-6, "indices": "…", "deltas": "…" } } },
  "colors": { "skin": "#c99a70", "hair": "#241a12" },
  "hidden": ["hair"],
  "garments": [{ "slot": "top", "id": "garment-id" }],
  "attachments": [{ "bone": "mixamorig:Head", "url": "https://…/crown.glb", "name": "Horned crown" }],
  "layers": [{ "id": "freckles", "kind": "makeup", "source": "catalog:freckles", "region": "scalp", "opacity": 0.7, "blend": "multiply", "uv": { "offset": [0.85, 0.517], "scale": 0.14, "rotation": -90 } }]
}
```

Every field is optional. An absent field means "default", and a document with no fields at all is stored as `null` (`isBakeable()` in `api/_lib/bake.js` treats it as nothing to render). Producers MUST omit rather than emit empty values, so that two identical bodies hash identically: the appearance hash is the cache key for the baked GLB.

| Field | Type | Meaning | Implementation |
|---|---|---|---|
| `outfit` | preset id | Baked outfit preset | `api/_lib/accessories.js` |
| `accessories` | preset id[] | Bone-mounted props (hat, glasses, earrings) | `src/agent-accessories.js` |
| `morphs` | name → weight | Shape. Any morph target the loaded GLB exposes, by name | `src/avatar-sculpt.js` |
| `proportions` | id → ratio | Build. Skeleton-space length, width and stature | `src/avatar-proportions.js` |
| `sculpt` | delta document | Free-brush vertex deltas, sparse and quantised | `specs/PARAMETRIC_AVATAR.md` |
| `colors` | slot → hex | Per-slot material tint | `src/avatar-studio.js` |
| `hidden` | slot[] | Garment layers to drop | `src/avatar-wardrobe.js` |
| `garments` | {slot, id}[] | Additive catalog wearables. Skinned pieces conform to `morphs` and `sculpt` (`src/garment-conform.js`); rigid pieces ride a bone | `specs/GARMENT_MANIFEST.md` |
| `attachments` | {bone, url, name?}[] | Custom bone-mounted props that are in no catalog | `src/agent-accessories.js` |
| `layers` | layer[] | Ordered texture layers over the canonical UVs (complexion, makeup, tattoo, decal) | `src/avatar-layers.js`, `api/_lib/bake-layers.js` |

## `morphs`: shape

`{ morphTargetName: weight }`, weights clamped to `[-1, 1]` (`[0, 1]` in the UI). Names are matched against whatever the loaded GLB actually carries: an unknown name is skipped, never an error, because the same document may be applied to a rig that exposes fewer shapes.

There is no fixed slider list. The parametric base (`public/avatars/parametric-base.glb`) ships 306 identity morphs and the panel renders one slider per morph it finds, so growing the base grows the editor with no UI change. The morph name `customSculpt` is reserved: it carries the `sculpt` field's deltas and is deliberately not offered as a slider, because its weight is pinned at 1.

## `proportions`: build

`{ parameterId: ratio }`. Each value is a ratio around `1.0`, where `1.0` is the base body. Morph targets cannot express this: a morph is a fixed set of vertex deltas in bind space, so it can reshape a limb but not lengthen one without tearing the skin off the bone that drives it. Length, width and stature are therefore skeleton-space parameters.

Parameters (declared in `PROPORTION_PARAMS`, which is the authoritative table):

| id | Range | Operation |
|---|---|---|
| `height` | 0.85 to 1.15 | Uniform scale of the armature node |
| `legLength` | 0.85 to 1.15 | Shin + ankle rest offsets |
| `torsoLength` | 0.85 to 1.15 | Spine chain rest offsets |
| `neckLength` | 0.80 to 1.25 | Neck + head rest offsets |
| `armLength` | 0.85 to 1.15 | Forearm + hand rest offsets |
| `shoulderWidth` | 0.85 to 1.20 | Clavicle + upper-arm lateral offset |
| `hipWidth` | 0.85 to 1.20 | Thigh lateral offset |
| `headSize` | 0.85 to 1.15 | Head joint scale |
| `handSize` | 0.85 to 1.20 | Hand joint scale |
| `footSize` | 0.85 to 1.20 | Foot joint scale |

Three invariants any implementation MUST hold:

1. **Rotations are never written.** Only a joint's rest `position` and `scale` change. This is what keeps proportions composable with everything else: the animation retargeter captures each rig's rest *rotations* at bind time to replay a clip in the target's own frame (`src/animation-retarget.js`), and morph deltas apply in bind space before skinning. Writing a rotation would invalidate both.
2. **The feet stay on the floor.** Lengthening the legs pushes the feet through the ground, so the hips move by the distance the ground bones actually moved, measured on the rig rather than derived from the ratios. Left and right deltas are averaged, which cancels the symmetric spread a width edit produces while preserving the vertical correction a length edit needs.
3. **Root motion is re-measured.** A clip's hip translation is authored around one hip height and rescaled onto the rig at bind time. After a proportion edit that factor is stale and the avatar foot-slides, so consumers call `AnimationManager.remeasureRigProportions()` with the rig at rest.

Values outside a parameter's range are clamped, unknown ids are dropped, and a value within `1e-4` of `1.0` is removed entirely (`normalizeProportions`). A rig missing a parameter's bones simply does not offer that slider (`availableProportionParams`), so the panel never shows a dead control.

## `sculpt`: free-brush deltas

Everything the morph library and the proportion table cannot reach: a dent in one temple, a crooked bridge, a brow ridge in no catalogue. A radius-and-falloff brush pushes vertices along their own surface normal and records the result as one extra morph target per mesh, named `customSculpt` and pinned at weight 1, so the edit stays additive with every library slider and reversible by clearing that one target.

The document is sparse (only vertices that moved) and quantised to int16 over the recorded peak, which resolves the 0.12 m displacement cap to under 4 micrometres. Its field-by-field contract, the bind-space maths and the symmetry rule are specified in [`PARAMETRIC_AVATAR.md`](./PARAMETRIC_AVATAR.md#3-free-sculpt-everything-else); validation is `sanitizeSculptDoc` in `src/avatar-sculpt-doc.js`, applied on both read and write like every other field.

A sculpt is tied to a topology. `vertexCount` records the mesh it was authored against, and a consumer whose mesh disagrees MUST skip that entry rather than force-fit it: a delta applied to the wrong vertices is a disfigured avatar, which is worse than an un-sculpted one.

## `attachments`: custom bone-mounted props

`accessories` names entries in the curated preset catalog, which is what makes a hat portable: the id resolves to a GLB the platform ships. A prop generated on demand (Scene Composer forges one from a text prompt and parents it to a bone) is in no catalog, so it carries its own reference instead:

```json
{ "bone": "mixamorig:Head", "url": "https://…/crown.glb", "name": "Horned crown" }
```

- `bone` is matched the way every other bone lookup is: exact name first, then the canonical form with the rig prefix stripped (`mixamorig:`, `CC_Base_`, `rig_`), so an outfit saved on one rig lands on another rig's equivalent joint. A bone the loaded rig does not have is skipped, per the processing rules below.
- `url` MUST be https on a three.ws asset host, or a same-origin path. Producers and consumers BOTH enforce this (`isTrustedAttachmentUrl` in `api/_lib/accessories.js`, `isSafeQueryModelUrl` in `src/shared/safe-model-url.js`), because a stored attachment is fetched by every browser that renders the avatar, including viewers who do not own it. An unrestricted URL would make one owner's public avatar a relay for arbitrary third-party bytes.
- At most 8 per document, matching `accessories`.
- Attachments are applied at runtime rather than baked: `bakeAppearance()` merges catalog GLBs it can resolve from the pack it ships with, and does not fetch remote URLs server-side. `isBakeable()` therefore ignores this field, and an avatar whose only appearance is attachments keeps serving its base GLB.

## `layers`: surface

Ordered array (bottom first) of at most 8 texture layers composited over the Parametric base's canonical UVs into one base-color texture. Each entry:

| Key | Type | Meaning |
|---|---|---|
| `id` | `[a-z0-9-]` 1-32 | Unique within the document. |
| `kind` | `complexion`, `makeup`, `tattoo`, `decal` | What the layer is. Drives the region rule below. |
| `source` | `catalog:<id>` or `upload:<id>` | An immutable catalog asset (`public/avatars/layers/index.json`) or an image the owner uploaded (`POST /api/avatars/layer-upload`, stored at `u/<userId>/layers/<id>.png`). Never a URL or a data URL. |
| `region` | `all` or a body region (`torso`, `upperArms`, `lowerArms`, `hands`, `hips`, `upperLegs`, `lowerLegs`, `feet`, `neck`, `scalp`) | The layer is clipped to this region of `parametric-base.regions.png`. `scalp` is the head and face, including the jaw that the bone-built mask leaves unassigned. |
| `opacity` | 0 to 1 | Layer strength. |
| `blend` | `normal`, `multiply`, `overlay` | sRGB blend against what is below. |
| `uv` | `{ offset: [u, v], scale, rotation }` | Sprite centre in UV (0 to 1), sprite width as a fraction of the texture (0.01 to 2), rotation in degrees clockwise (-180 to 180). |
| `tint` | `#rrggbb`, optional | Multiplies the sprite colour. Lets one monochrome catalog sprite serve any ink or lip colour. |

Rules:

- `tattoo` and `decal` layers may not use `region: "scalp"` or `"all"`: face art is `makeup`, and a tattoo clipped to the body can never reach the lips. Eyes, teeth and tongue are separate meshes the layers never touch.
- Compositing is deterministic (`src/avatar-layers.js`, pure JS over RGBA arrays, no canvas): the same document and the same sources give byte-identical pixels in the browser and the baker, which is what makes the bake cacheable by the appearance hash.
- The composite is 2048 by 2048. The baker paints it over the skin colour (`colors.skin` or the material factor), then sets the material factor to white, so the texture carries the whole skin colour.
- Layers apply only to the Parametric base, whose body material has no texture of its own. On any other body the field is stored and ignored by the baker.
- `layers: []` is omitted, like every other empty field.

## Reserved

Named here so implementations do not claim the keys for anything else:

| Field | For |
|---|---|
| `base` | Explicit base-body id, once more than one parametric base ships |

## Animation identity

`animation` is an optional object that gives an avatar its own body language. Every key is optional; an unset key means the platform default.

| Key | Type | Meaning |
|---|---|---|
| `idle` | clip id | Resting loop (platform default `idle`) |
| `walk` | clip id | Locomotion loop (platform default `av-walk-feminine`) |
| `gestureIntensity` | number 0..1 | Playback speed scale for one-shot gestures (default 0.5, which is real time) |
| `moodBlend` | number 0..1 | How strongly the mood layer shows through |
| `emotes` | clip id[] (max 8) | Emote loadout. The first entry is the default gesture; empty falls back to `wave` |

Clip ids are names in `public/animations/manifest.json`. The API rejects an unknown id (`api/_lib/animation-clips.js`), so the record only ever names a clip that exists; a runtime still falls back to the platform default if a clip cannot play on a given rig. All runtimes resolve clips through `src/avatar-animation-identity.js` (`resolveClip`). The server bake and `appearanceHash` ignore `animation` entirely: changing it never re-bakes the GLB.

## Processing rules

- **Normalize on read and on write.** Every field is validated at both boundaries. A hand-edited or hostile record must never reach the rig.
- **Skip, do not fail.** An unresolvable morph name, preset id, garment or bone is dropped with a warning. A document that half-applies still produces a usable avatar; one that throws produces none.
- **Order-independent.** The rendered body is a function of the document alone, never of the order fields were applied in.
- **Idempotent.** Applying the same document twice to the same rig yields the same result. Implementations re-apply from a captured bind pose rather than compounding onto the current state.

## Related

- [`PARAMETRIC_AVATAR.md`](./PARAMETRIC_AVATAR.md): the base body these parameters describe, its morph inventory, and the free-sculpt wire format.
- [`GARMENT_MANIFEST.md`](./GARMENT_MANIFEST.md): the wearables `garments` references.
- [`EDITOR_SPEC.md`](./EDITOR_SPEC.md): the authoring surface these parameters are edited in.
- [`docs/avatar-studio.md`](../docs/avatar-studio.md): the user-facing guide to the editor.
