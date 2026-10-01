A shirt has no skeleton of its own. Rig one on its own and the auto-rigger fits a whole skeleton inside the cloth, which tears the shirt apart as soon as it moves. So the garment forge behind the three.ws wardrobe rigs each piece while a reference body is wearing it, then takes the body away and keeps the weights each patch of cloth picked up from the joint underneath it.

![Three garments from the three.ws wardrobe catalog, each turned in its live 3D viewer: a yellow rain slicker with its hood up, a black leather biker jacket, and a charcoal hooded sweatshirt.](/x-media/wardrobe-article/garments-in-3d.png)

## From a sentence to a mesh

A piece starts as a line of text and a slot: top, bottom, footwear, outerwear, hair, headwear, glasses or accessory. The forge walks it through seven stages in order, and the wardrobe page shows each one as it runs: image, mesh, compose, rig, extract, validate, publish. A finished piece takes about seven minutes.

The image stage paints a ghost-mannequin product photo: the garment as if worn, in an A-pose, from the front, on a plain background. That pose is not a style choice. It matches the body the garment will be fitted to, so the mesh that comes out of the next stage already has its sleeves where an arm will be. The mesh stage rebuilds that photo as a textured 3D model on our image-to-3D lanes, falling through to the next engine when one is down.

## Dress a body, rig the pair, take the body away

The compose stage scales the new mesh and places it in its slot's region on a canonical reference body: an A-pose figure 1.667 m tall with 52 joints. A shirt goes over the torso, shoes over the feet, hair on the crown.

Then the forge rigs the composite, body and garment together, on the same auto-rigging worker that rigs our avatars. This is the step the rest depends on. The rigger sees an ordinary clothed person, so the skeleton lands at body scale, and each vertex of the sleeve takes its weights from the arm bones it actually sits on rather than from a skeleton squeezed inside the fabric.

The extract stage strips the reference body back out. The file is rebuilt from scratch with only the garment's geometry, skin and textures, and the joint names are rewritten to the canonical skeleton, so `mixamorig:LeftArm` becomes `LeftArm`.

We measured this against the obvious alternative before choosing it. The same generated shirt was skinned both ways, put on the reference body and walked through the canonical walk clip. Rigged as a pair, the cloth stayed a mean 2.87 cm from the body across the gait. Copying weights from the nearest body vertex left it 5.88 cm away. The pair-rigging lane is the one in production.

## What a piece has to prove before it is published

The validate stage is where pieces fail on purpose:

- **Size.** A generator once answered a prompt for long straight hair with a mesh about 1.4 m deep whose width was still perfect. Each slot has a size envelope now, and a mesh outside it fails the job with the measurement instead of reaching the catalog.
- **Bind coverage.** The share of the garment's skin weight that lands on bones a body really has is measured before publishing. Under 60% and the job fails.
- **What it hides.** A piece declares which body regions it covers, so skin cannot poke through cloth. A region counts when it carries at least 10% of the garment's skin weight, and the result is clamped to what the slot may plausibly hide: a shirt cannot hide the legs, and hair can hide nothing at all.
- **Provenance.** The manifest pins the file's sha256 and a licence from an approved set. The pieces in the catalog today are all generated and licensed CC0.

A piece that passes lands in its own versioned directory, and its manifest is appended to one public catalog file. This is the real manifest of the white oxford shirt, trimmed:

```json
{
  "id": "a-white-oxford-cotton-dress-cf4ea6",
  "slot": "top",
  "model": { "format": "gltf-binary", "sha256": "6c9b0f29...d25c", "triangleCount": 40000 },
  "rig": {
    "skeleton": "three.ws-canonical-v1",
    "bindPose": "a-pose",
    "bones": ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "..."]
  },
  "occludes": ["torso", "upperArms"],
  "license": "CC0-1.0"
}
```

![The three.ws wardrobe catalog: search, slot filters, and a grid of generated pieces including a white oxford shirt, dark denim jeans, two leather biker jackets, sunglasses, a black t-shirt, two hairstyles and a leather messenger bag, each with a 3D button.](/x-media/wardrobe-article/catalog-grid.png)

## Putting it on

When a piece is worn, the browser binds it to the avatar's skeleton by name. Each garment bone is matched to the avatar's bone through the same canonicalizer that lets our animation library drive any humanoid, and a helper joint the avatar lacks falls back to its nearest mapped parent. The garment keeps its own inverse bind matrices, which is what lets a piece authored in one rest pose land on an avatar resting in another. The client refuses a piece that binds under 60% of its skin weight, or that is larger than 0.75 times the avatar's height on any axis, and it checks the file's hash before attaching anything. Rigid pieces such as glasses are parented to a single joint instead of deformed.

## Where it falls short

The binding is to the skeleton, not to the body's shape. A garment keeps the shape it had on the reference body and follows the avatar's bones from there; nothing reshapes it around a body with very different proportions. On an avatar close to the reference it fits well, and on one built very differently it can sit loose, tight or offset. Fitting cloth to the body it lands on is work we have not shipped.

Wearing a piece also needs an account: you open one of your avatars in the editor and dress it from the Wardrobe tab. Browsing the catalog and turning any piece around in 3D needs nothing.

The catalog is at [three.ws/wardrobe](https://three.ws/wardrobe), and the [wardrobe docs](https://three.ws/docs/avatar-wardrobe) cover the manifest contract and the binding in full.
