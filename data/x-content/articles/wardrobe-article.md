We typed one line into the three.ws garment forge: "a white oxford cotton dress shirt, long sleeves, buttoned", and chose the slot top. A finished piece takes about seven minutes. What came back is a 2.7 MB shirt of 40,000 triangles, rigged to the three.ws canonical skeleton, with a manifest that pins its checksum and licence, published to a public catalog under CC0-1.0, where any humanoid avatar can put it on.

A shirt has no skeleton of its own. Rig one alone and the auto-rigger fits a whole person inside the cloth, which tears the shirt apart as soon as it moves. So the forge rigs each piece while a reference body is wearing it, then takes the body away and keeps the weights each patch of cloth picked up from the joint underneath it. This article follows that one shirt through each stage, explains why each stage exists in plain words, and shows the numbers the pipeline measured. The figures below are read from the forge's own README, the live wardrobe page or the public catalog, so each one can be checked.

![Three garments from the three.ws wardrobe catalog, each turned in its live 3D viewer: a yellow rain slicker with its hood up, a black leather biker jacket, and a charcoal hooded sweatshirt.](/x-media/wardrobe-article/garments-in-3d.png)

## Eight slots, one body of rules

A piece starts as a line of text and a slot. The wardrobe knows eight: top, bottom, footwear, outerwear, hair, headwear, glasses and accessory. A slot is more than a label. It decides where on the reference body the mesh is placed, how it is scaled, how large it may be, and which parts of the body it is allowed to hide. One garment occupies one slot at a time, so putting on a new jacket takes the old one off.

The forge walks a prompt through seven stages in order, and the wardrobe page shows each one as it runs: image, mesh, compose, rig, extract, validate, publish. The job record keeps the current stage, so a page that polls it shows real progress instead of a guess. The shirt below went through all seven, and the sections that follow take them one at a time.

## A photograph comes before the shape

Image-to-3D models read pictures, not sentences, so the opening stage paints the garment. The prompt becomes a ghost-mannequin product photo, a garment shown as if worn, without the person: the worn shape, in an A-pose, from the front, on a plain background. That pose is not a style choice. It matches the body the garment will be fitted to, so the mesh that comes out of the next stage already has its sleeves where an arm will be.

The picture is drawn by a Gemini image model on Vertex AI, at 2K resolution, because the quality of the reference sets the quality of the mesh. The stage handles the two ways an image model can answer without a picture. An empty draw is a chance event, so the stage rolls again, up to three attempts by default. A refused wording is a decision, so re-rolling cannot change it: the job reports the block reason and the slot at once, with an instruction to rephrase, and the person who submitted it knows what to change in one read.

![Left, the reference photograph the forge painted for the white oxford shirt: a ghost-mannequin product shot on a pale background with a button-down collar and six buttons. Right, the finished 3D shirt turned slightly in the viewer, with the same collar, placket and cuffs.](/x-media/wardrobe-article/photo-to-shirt.png)

The left half of that picture is the catalog thumbnail, which is the reference photograph itself. The right half is the finished mesh rendered live. The collar, the placket, the cuffs and the drape carry across.

## The photograph becomes a mesh

The mesh stage sends the photograph through the image-to-3D chain, and the first healthy rung wins. The warm primary is Hunyuan3D 2.1 on a Cloud Run service with an RTX GPU, which paints a full PBR material set. Behind it sits the same engine on an L4 GPU service, and behind that TRELLIS, a different model behind the same API contract. A job asks the chain and takes the answer from whichever engine is healthy, so a busy engine does not hold up a piece. The oxford shirt's manifest records which engine built it: hunyuan3d-2.1.

The mesh arrives at about 40,000 triangles, which is the budget the forge targets. That is a deliberate budget: it is dense enough to show a collar and cuffs, and light enough to render in a browser beside other things.

## Dress a body, rig the pair

The compose stage scales the new mesh and places it in its slot's region on a canonical reference body: an A-pose figure 1.667 m tall with 52 joints. A shirt goes over the torso, shoes over the feet, hair on the crown. Each slot has a measured box on that body:

| Slot | Box centre (m) | Box size (m) | Fit |
|---|---|---|---|
| top | 0.0, 1.14, 0.03 | 0.90, 0.56, 0.45 | height |
| outerwear | 0.0, 1.05, 0.03 | 1.00, 0.80, 0.50 | height |
| bottom | 0.0, 0.50, 0.02 | 0.50, 0.90, 0.35 | height |
| footwear | 0.0, 0.09, 0.07 | 0.60, 0.18, 0.30 | depth |
| hair | 0.0, 1.58, 0.03 | 0.30, 0.25, 0.30 | width, top anchored to the crown |
| headwear | 0.0, 1.60, 0.03 | 0.30, 0.22, 0.30 | contained on all three axes |
| glasses | 0.0, 1.547, 0.11 | 0.18, 0.08, 0.12 | width |
| accessory | 0.0, 1.20, 0.05 | 0.35, 0.35, 0.25 | width |

Then the forge rigs the composite, body and garment together, on the same auto-rigging worker that rigs our avatars. This is the step the rest depends on. The rigger sees an ordinary clothed person, so the skeleton lands at body scale, and each vertex of the sleeve takes its weights from the arm bones it sits on rather than from a skeleton squeezed inside the fabric. The worker runs Make-It-Animatable, an open model released under the MIT licence and published at CVPR 2025.

## Take the body away

The extract stage strips the reference body back out. The file is rebuilt from scratch with only the garment's geometry, skin matrices and textures, and the joint names are rewritten to the canonical skeleton, so `mixamorig:LeftArm` becomes `LeftArm`. What remains is a garment that carries a skeleton's worth of weights without carrying the body that taught it.

Placement also enforces a size envelope for each slot. The fit axis pins the one dimension a slot cares about, and the envelope bounds the others. The hair slot shows the idea: its width tracks the head, its envelope allows anything from a pixie cut to a waist-length fall up to 0.80 m tall, and the top of the mesh is anchored to the crown, so length hangs down the back rather than straddling the head.

We checked the finished shirt in the Rig Doctor, the page that diagnoses a GLB in your browser without uploading it. All four limb groups mapped:

![Rig Doctor's report on the oxford shirt: every limb group marked Will animate.](/x-media/wardrobe-article/rig-doctor-shirt.png)

## Measured against the obvious alternative

There is a simpler way to skin a garment: copy the weights from the nearest vertex of a body. We built both and raced them. The same generated shirt was skinned by each, attached to the parametric base body and driven through the canonical walk clip, while the bake-off measured how far the cloth strayed from the body across the gait:

| Skinning path | Mean | 95th percentile | Maximum |
|---|---|---|---|
| Rig the pair, then remove the body (production) | 2.87 cm | 6.36 cm | 16.12 cm |
| Nearest-vertex weight transfer | 5.88 cm | 13.06 cm | 21.02 cm |

Rigging the pair kept the cloth about half as far from the body at the mean, and it is the only lane the forge uses in production. The weight-transfer code stays in the repository as the offline test rig for the runtime binder, and the bake-off script is there to run again whenever either path changes.

## What a piece proves before it is published

The validate stage is where a piece earns its place in the catalog:

| Gate | What it measures | Rule |
|---|---|---|
| Size | The mesh's extent against the slot's envelope | A mesh outside it fails with the measurement |
| Bind coverage | The share of skin weight that lands on bones a body has | At least 60% |
| What it hides | Regions carrying skin weight | A region counts at 10% or more of the weight |
| Provenance | The file's sha256 and a licence | Licence from the approved set |

Bind coverage is the share of skin weight that lands on bones a body has, and a piece needs at least 60% of it. A region counts as covered when it carries 10% or more of the weight. Bind coverage is measured with the same number the wearer checks, so a piece that publishes is a piece the closet will accept. The occlusion result is clamped to what the slot may plausibly hide: a shirt cannot hide the legs, and hair can hide nothing at all, because the scalp region resolves to the head bone and hiding it would take the face with it. The approved licences are CC0, CC-BY, MIT, Apache-2.0 and BSD, and the pieces in the catalog today are generated and licensed CC0.

A piece that passes lands in its own versioned directory, and its manifest is appended to one public catalog file. This is the real manifest of the oxford shirt, trimmed:

```json
{
  "id": "a-white-oxford-cotton-dress-cf4ea6",
  "slot": "top",
  "model": { "format": "gltf-binary", "sha256": "6c9b0f29...d25c", "sizeBytes": 2799620, "triangleCount": 40000 },
  "rig": { "skeleton": "three.ws-canonical-v1", "bindPose": "a-pose", "bones": ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "..."] },
  "occludes": ["torso", "upperArms", "lowerArms", "hips", "upperLegs", "neck"],
  "license": "CC0-1.0",
  "source": { "kind": "generated", "model": "hunyuan3d-2.1", "pipeline": "garment-forge@1" }
}
```

The occludes list names the six body regions this shirt covers: torso, upperArms, lowerArms, hips, upperLegs and neck.

The catalog is a single public JSON file, and it needs no key. Paste this to list it by slot:

```bash
curl -s https://storage.googleapis.com/three-ws-garments/garments/catalog.json \
  | python3 -c "import json,sys,collections; c=json.load(sys.stdin); print(len(c), 'pieces'); [print(k, v) for k, v in sorted(collections.Counter(g['slot'] for g in c).items())]"
```

The wardrobe page lists the whole catalog, and each piece has a 3D button that turns it in a live viewer.

![The three.ws wardrobe catalog: search, slot filters, and a grid of generated pieces including a white oxford shirt, dark denim jeans, two leather biker jackets, sunglasses, a black t-shirt, two hairstyles and a leather messenger bag, each with a 3D button and a Dress your avatar button.](/x-media/wardrobe-article/catalog-grid.png)

## A job that outlives its instance

A piece takes minutes, and a service is free to scale up and down in that time, so the record of a job in storage is also its work queue. An instance owns a job only once it holds a concurrency slot and wins an atomic, generation-matched write on the record. Everything the pipeline needs is stored at submit, so any instance can drive a job it did not receive. A freed slot drains the backlog straight away, a sweep every 10 minutes claims any orphan, and a job read requeues one whose owner went quiet. A job is declared failed only after three attempts, so a replaced instance costs an attempt, not the piece.

The platform exposes the forge at a rate-limited endpoint, with the key held server-side. A submit takes one attempt, because it starts a GPU job and is not safely repeatable; a read takes three. This is the request shape, and the page saves the job id in the browser, so a visitor who closes the tab at minute three finds the job still running on return:

```bash
curl -s https://three.ws/api/garment-forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a red varsity jacket","slot":"outerwear"}'
# 202 { "job_id": "...", "status": "queued", "eta_seconds": ... }

curl -s "https://three.ws/api/garment-forge?job=<job_id>"
# { "status": "...", "stage": "rig", "glb_url": "...", "manifest_url": "...", "coverage": ..., "occludes": [...] }
```

## Putting it on

When a piece is worn, the browser binds it to the avatar's skeleton by name. Each garment bone is matched to the avatar's bone through the same canonicalizer that lets our animation library drive any humanoid, and a helper joint the avatar lacks falls back to its nearest mapped parent. The garment keeps its own inverse bind matrices, which is what lets a piece authored in one rest pose land on an avatar resting in another.

The wearer checks the piece before it touches the avatar. It refuses a piece that binds under 60% of its skin weight, or that is larger than 0.75 times the avatar's height on any axis, and it verifies the file's sha256 before attaching, so a truncated download is refused. Rigid pieces such as glasses are parented to a single joint instead of deformed. A garment keeps the shape it had on the reference body and follows the avatar's bones from there, which preserves the silhouette it was designed with. To wear a piece, open one of your avatars in the editor and use the Wardrobe tab. Browsing the catalog and turning any piece around in 3D needs nothing.

Because a manifest pins its file's hash, anyone can repeat the wearer's integrity check from a terminal. This Node script fetches the oxford shirt's manifest, downloads the GLB it names and compares the digest:

```js
import { createHash } from 'node:crypto';

const base = 'https://storage.googleapis.com/three-ws-garments/garments/top/a-white-oxford-cotton-dress-cf4ea6/v1';
const manifest = await (await fetch(`${base}/manifest.json`)).json();
const bytes = Buffer.from(await (await fetch(manifest.model.uri)).arrayBuffer());
const sha = createHash('sha256').update(bytes).digest('hex');

console.log(sha === manifest.model.sha256 ? 'hash matches' : 'hash differs');
console.log(`${bytes.length} bytes read, ${manifest.model.sizeBytes} pinned`);
console.log(`${manifest.slot} on ${manifest.rig.skeleton}, hides: ${manifest.occludes.join(', ')}`);
console.log(`licence ${manifest.license}, built by ${manifest.source.model}`);
```

It prints `hash matches` and 2799620 for both byte counts. In the browser the same check is `verifyModelBytes(bytes, manifest)` from the catalog loader, followed by `attachGarment(avatarRoot, garmentRoot, { slot: manifest.slot })`, which returns `ok`, the measured `coverage`, a `reason` when it refuses, and a `detach` function that takes the piece off again.

The catalog also holds itself to a standard. A catalog audit binds each live piece onto four different humanoid rigs, checks each file's hash, and measures how far the cloth strays across the walk gait, with a ceiling for each slot. The baseline run covered 23 entries, all binding at full coverage on all four rigs.

## Open work, credited

The forge stands on open work. Make-It-Animatable, released under the MIT licence and published at CVPR 2025, predicts the skeleton and skinning weights for the composite. The reference body is released under CC0 and derives from MakeHuman data. Hunyuan3D 2.1 and TRELLIS are the image-to-3D engines in the failover chain, and Gemini on Vertex AI paints the reference photograph.

## What is next

A piece keeps the shape it was designed with, and that is the right default: a leather jacket stays a leather jacket on a taller body. The direction we are exploring is fit-to-body shaping, where the same piece is offered in a cut that follows a taller, broader or slimmer avatar, using the morph sliders the parametric base already carries. The catalog audit is the test bed for it. New fitting paths are measured with the same walk-gait deviation numbers before a piece is allowed to use it, the way the pair-rigging lane earned its place against weight transfer.

Two more lanes reuse the pipeline unchanged. The slot table takes new rows as a box and a fit rule, and the manifest format describes a wearable by slot, bones and the regions it hides, so footwear variants, layered outerwear and new accessory types arrive as data and a measured box. If you generate a piece and want it in the catalog, the wardrobe page runs the same seven stages you read about here.

## The partners behind the garment forge

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as three.ws/partners states it. The full map is at [three.ws/partners](https://three.ws/partners).

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The wardrobe, the Model Inspector and Rig Doctor are free and run in the browser.

**IBM.** IBM is listed in the Strategic tier of the partner map. three.ws agent identity integrates with IBM watsonx and IBM Granite.

**Amazon Web Services.** three.ws is deployed on AWS infrastructure with Marketplace availability.

**Google Cloud.** Google Cloud powers three.ws inference, storage and real-time serving. For this forge that means Vertex AI painting the reference photograph, Cloud Run hosting the orchestrator and the GPU workers, and a public Cloud Storage bucket serving the catalog.

**Alibaba Cloud.** Alibaba Cloud extends three.ws into APAC markets with Qwen model integration and regional MCP server deployment, with low-latency inference close to users in Asia.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing. The mesh and rigging stages run on GPU workers.

**HackerNoon.** three.ws has a builder-focused publishing partnership with HackerNoon: feature articles, tutorials and developer guides for people shipping with AI, published to HackerNoon's developer audience.

**Quicknode.** three.ws is a member of the Quicknode Startup Program with approved infrastructure credits.

## Try it

Browse the catalog and turn any piece in 3D at [three.ws/wardrobe](https://three.ws/wardrobe), where you can also describe a new piece and watch the seven stages run. The manifest contract, the binding rules and the endpoint are in the [wardrobe docs](https://three.ws/docs/avatar-wardrobe). The oxford shirt's [manifest](https://storage.googleapis.com/three-ws-garments/garments/top/a-white-oxford-cotton-dress-cf4ea6/v1/manifest.json) is public, and the [Model Inspector](https://three.ws/inspect) and [Rig Doctor](https://three.ws/rig-doctor) check any garment you export, in your browser, without uploading it.
