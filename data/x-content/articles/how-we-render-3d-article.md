A reader asked us how we render 3D, under our OpenAI Select Partner announcement. It is a fair question for a 3D company, and it deserves a long answer in place of a one-liner. This is that answer, from the opening byte to the final pixel.

The short version fits in one sentence. A three.ws model is a glTF file. A browser downloads it, decodes it on the visitor's own graphics chip with Three.js and WebGL, lights it, animates it, and draws it frame after frame, with no plugin, no video and no server rendering a single frame. The rest of this article follows one rigged character through each of those steps, then shows the tools around the renderer, the partners who carry the weight underneath, and where we are heading next.

![A rigged three.ws avatar standing in the live glTF viewer: a figure in a long yellow oilskin coat, rendered in the browser by Three.js with studio lighting](/x-media/how-we-render-3d-article/cover.png)

## The answer in one picture

Rendering 3D on the web is a relay with five runners. Each one hands a smaller, simpler thing to the next.

| Stage | What happens | Where it lives |
|---|---|---|
| 1. Make | Words or a photo become a textured mesh, then a rigged one | `workers/model-*`, `workers/rig` |
| 2. Pack | The file is a binary glTF (GLB), mesh-compressed for the wire | `scripts/` optimiser |
| 3. Load | The browser fetches it and decodes geometry and textures | `src/viewer.js`, `src/viewer/internal.js` |
| 4. Light | Environment light, three studio lights and a soft contact shadow | `src/viewer/lights.js` |
| 5. Move | A clip library retargets motion onto the skeleton, frame by frame | `src/animation-manager.js` |

Everything in stages 3 to 5 runs on the visitor's device. That is the design choice behind the whole platform: the heavy, one-time work (making and rigging a model) happens on our GPUs, and the repeated work (drawing it, many times a second, for each viewer) happens on the hardware each viewer already owns. A page with a thousand visitors does not need a thousand render servers.

## Stage 1: a model is made before it is drawn

A 3D model has to come from somewhere. On three.ws it comes from the Forge, which turns a sentence or a photo into a textured mesh. The plain-language version is five moves: the words become a reference picture, the picture becomes a shape, a suitable engine is chosen for the job, a failover moves the work on if an engine is busy, and the result is saved permanently so its link keeps working.

The engines are open models that run on our own Cloud Run GPU services: TRELLIS.2, a self-hosted TRELLIS, Hunyuan3D 2.1 and TripoSG, plus a free hosted lane on NVIDIA's inference service. Each worker is a small service with the same contract: `POST /infer` returns a task id, `GET /tasks/:id` reports progress and finally hands back a storage URL. Raw output lands in Google Cloud Storage and is mirrored to Cloudflare R2, because a link that expires in an hour is no use to a page that is meant to last.

The Forge offers three quality tiers. Draft is about 12,000 polygons, Standard about 30,000 with 2K textures, and High goes up to 200,000 polygons with a full PBR material set. A character that has to share a browser tab with other things lives happily at Standard.

| Forge tier | Geometry | Textures | Suited to |
|---|---|---|---|
| Draft | about 12,000 polygons | single baked colour | quick previews and layout |
| Standard | about 30,000 polygons | 2K textures | characters and props in a page |
| High | up to 200,000 polygons | full PBR set | hero shots and close-ups |

The same Forge is reachable over plain HTTP, with no account and no key. This is the request that returns a model:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"forge_avatar",
        "arguments":{"prompt":"a lighthouse keeper in a yellow oilskin coat"}}}'
```

A static mesh cannot walk, so the next stage is a rig. Our rigging worker runs Make-It-Animatable, an open model released under the MIT licence and published at CVPR 2025. It predicts a 52-bone Mixamo-style skeleton with skin weights, writes it into the original GLB bytes so the materials and PBR textures are preserved byte for byte, and adds the 52 ARKit expression shapes a face needs to blink and speak. The full story of that pipeline, one job at a time, is in our Forge write-up.

## Stage 2: the file is packed for the wire

A model reaches the renderer as a GLB, the single-file binary form of glTF 2.0, the open standard from the Khronos Group. glTF is to 3D what JPEG is to photographs: a format that the major engines read, so a model made here works in other tools and the other way round.

Size is the enemy of a fast opening paint, so most three.ws GLB files are meshopt-compressed, which shrinks geometry without changing how it looks. For models that arrive heavy, the optimiser script in `scripts/` runs lossless passes (deduplicate, prune, weld, resample) through glTF-Transform and re-encodes textures as WebP, and its output stays within the standard glTF 2.0 feature set so it loads in any glTF loader with no decoder wiring. The script's own documentation puts a typical saving at 90 percent of the file size. Draco and KTX2 are supported on the way in as well, for models that arrive packed that way.

## Stage 3: the browser loads and decodes it

| Decoder | What it unpacks | Loaded from |
|---|---|---|
| Meshopt | compressed geometry | bundled module, loaded when needed |
| Draco | compressed geometry | `public/three/draco/gltf/` on our own origin |
| KTX2 (Basis) | GPU-compressed textures | `public/three/basis/` on our own origin |

Here is the loader chain from `src/viewer.js`, the heart of the renderer. It is short because Three.js does the hard parts and we choose the decoders:

```js
const loader = new GLTFLoader(MANAGER)
  .setCrossOrigin('anonymous')
  .setDRACOLoader(dracoLoader)
  .setKTX2Loader(ktx2Loader.detectSupport(this.renderer))
  .setMeshoptDecoder(meshoptDecoder);
```

Three details make it fast. One: the decoders are loaded lazily, and once, so the opening paint of a page does not pay for decoders it may not need. Second, the Draco and Basis transcoder binaries are served from the same origin as the site, with a public CDN as a second line, so a model does not wait on a third party to appear. Third, the loader's progress events drive the visible loading percentage, so a visitor sees the real state of the download.

The renderer itself is a WebGL renderer on the Three.js 0.184 line. Pixel ratio is capped (2.0 by default, 1.5 in embeds, 1.0 on low-power phones) because the difference between a sharp image and a smoother battery is a design decision, not an accident. Rendering is invalidation-driven: a still model costs almost nothing, and frames are drawn when the camera moves or the animation advances. Picking and hover use BVH-accelerated raycasting from the three-mesh-bvh library, so touching a character's shoulder in a mesh of tens of thousands of triangles responds at once.

![The three.ws glTF validator page: it runs the official Khronos glTF 2.0 validator and a performance inspector entirely in the browser, with sample models to try](/x-media/how-we-render-3d-article/validator.png)

Any model can be checked the way our loader sees it. The validator page runs the official Khronos glTF 2.0 validator in WebAssembly, fully client-side, and a performance inspector reports texture weights, draw-call shape and compression opportunities. Open a file in it and nothing leaves your machine.

## Stage 4: light makes it look real

A mesh is a statue in the dark. What makes it read as fabric, skin or metal is light, and three.ws lights each model the same way a photo studio does.

The base is environment lighting: a small environment map, built once with Three.js's PMREM generator, wraps the model in soft light from all directions and gives metals something to reflect. Over it sit three studio lights. The key and fill ride with the camera so the face stays lit as you orbit. The rim light is anchored in the world, so a silhouette keeps its bright edge. A single shadow-casting light draws a soft contact shadow beneath the figure so it stands on the ground instead of floating.

Colour is finished by the Khronos PBR Neutral tone mapper, designed so that a product colour authored in a material comes out on screen as the same colour, which is the right behaviour for avatars, clothing and brand assets. Exposure is a single slider in stops, so the maths a visitor sees is the maths a photographer expects.

For the moments that call for drama there is a cinematic pass built on the postprocessing library: a render pass, a normal and depth pass, ambient occlusion, depth of field, bloom and a colour grade, each with defaults tuned for a studio look and a preset that turns the whole chain off.

![The Holo Sticker page: a holographic foil sticker with an iridescent surface, die-cut outline and a peeling corner, computed live in the browser with no images and no model files](/x-media/how-we-render-3d-article/holo-live.png)

Materials can go much further than a still of cloth. The Holo Sticker is a foil built from Three.js's `MeshPhysicalMaterial`, a physical material, with the die-cut outline vectorised from a canvas by a marching-squares tracer and the peeling corner produced by a vertex-shader cylinder roll injected into the material. The page says it plainly: the outline, the foil, the reflected light and the peel are all computed in the visitor's browser, with no images and no model files. The Forge's restyle tool uses the same idea in reverse, asking IBM Granite to propose PBR values for a request such as "make it chrome" and re-exporting the GLB with the new material.

## Stage 5: motion and expression

A skeleton is half of movement. The other half is a library of clips that fit any skeleton. Avatars arrive from many tools, each with its own bone names: Mixamo, VRM and VRoid, Unreal, Blender Rigify, Daz, MakeHuman, Roblox and more. `src/glb-canonicalize.js` recognises roughly two dozen of these naming families and rewrites joint names to one canonical set, fingers included. Thirty of the 53 tracks in each clip address a finger, so that mapping is what lets a hand wave look like a hand wave.

`src/animation-retarget.js` then does the retargeting. Clips are authored against one reference rig; the retargeter rewrites track names, rescales hip translation and applies per-bone corrections for rigs that rest in a T-pose rather than an A-pose. It is a pure module, so the same code runs in the browser and in Node, which is how the `apply_animation` MCP tool uses it. A rig that cannot be skeleton-driven at all falls back to a default rig and does not show a bind-pose T-pose. The `agent:ready` event does not fire, and the stage stays invisible, until the opening pose is on screen.

The motion library itself is on the [Animation Gallery](https://three.ws/animations), browsable by category with live previews on hover, and the Animation Studio lets anyone pose a skeleton, keyframe it and export an animated GLB.

![The three.ws Animation Studio: a posable mannequin on a grid, a bone list on the left, pose presets on the right and a keyframe timeline along the bottom](/x-media/how-we-render-3d-article/pose-studio.png)

Faces move through morph targets. The runtime resolves the canonical ARKit names such as `jawOpen`, `mouthSmile` and `browInnerUp` to the concrete slots in each mesh, drives lip sync with nine visemes derived from the speech audio's frequency bands, and falls back to a jaw-open motion on rigs that have no viseme shapes at all. The effect is that one voice line can move any avatar's mouth convincingly.

| Layer | What drives it | Fallback |
| --- | --- | --- |
| Expression | ARKit morph names such as jawOpen, mouthSmile, browInnerUp | Resolved to each mesh's own slots |
| Mouth | Nine visemes from the audio's frequency bands | Jaw-open motion when a rig has no viseme shapes |
| Body | Canonical clip library, retargeted per rig | Default rig when a skeleton cannot be driven |

## One tag puts it on any website

All of the above is wrapped in a web component. This is the whole embed, and it is the answer to "how do I use it":

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"></script>

<agent-3d
  src="https://three.ws/avatars/michelle.glb"
  mode="inline"
  width="480"
  height="640"
  background="transparent">
</agent-3d>
```

The element has an open shadow DOM, 25 observed attributes (source, mode, voice, framing, chat, walk and more) and four layout modes: inline, floating, section and fullscreen. It boots lazily, when it comes within 300 pixels of the viewport, so a page with several avatars stays light. Browsers allow about sixteen WebGL contexts per tab, so the element keeps at most eight viewers live and gracefully releases the one that has been offscreen longest, rebuilding it when the visitor scrolls back. Events such as `agent:load-progress`, `agent:ready` and `skill:loaded` let page code react at each stage. Page code listens like any DOM event:

```js
const el = document.querySelector('agent-3d');

el.addEventListener('agent:load-progress', (e) => {
  console.log(e.detail.phase, Math.round(e.detail.pct * 100) + '%');
});

el.addEventListener('agent:ready', (e) => {
  console.log('ready', e.detail.agent, e.detail.manifest);
});
```

| Boot phase | Progress reported |
|---|---|
| manifest read | 10 to 30 percent |
| body (the 3D model) | 45 percent |
| memory | 60 percent |
| skills | 75 percent |
| brain | 90 percent |

That is also how the rest of the platform shows models: the avatar pages, the Drive screen, the walkable worlds and the embeds on partner pages all mount the same renderer.

## Tools that check the work

A renderer is as good as the files it is fed, so we publish the instruments we use ourselves, all of them free and all of them running in the browser.

![Rig Doctor: a page that diagnoses whether a GLB will animate, with a drop zone, sample rigs to try and counters for joints scored and rig conventions recognised](/x-media/how-we-render-3d-article/rig-doctor.png)

**Rig Doctor** answers the question an animator asks at the start: will this avatar move? It scores 52 canonical joints against 16 recognised rig conventions, in your browser, in about a second, and offers a one-click repair download. **The validator** checks a file against the Khronos suite. **The Inspector** reports whether a model would pass into our catalog. **The viewer** opens any https GLB at a link, with a download button. Because the diagnostics mirror the exact gates in the runtime, a green result there is a promise about what the renderer will do.

| Tool | What it answers | Where it runs | Address |
| --- | --- | --- | --- |
| Rig Doctor | Will this avatar animate? | In your browser, file never uploaded | three.ws/rig-doctor |
| Validator | Does this file pass the Khronos suite? | In your browser | three.ws/validation |
| Viewer | What does this GLB look like, lit and orbitable? | In your browser, any https link | three.ws/viewer |
| Holo Sticker | How does this model look as a shareable card? | In your browser | three.ws/holo |

## The field, and where we chose to build

The 3D web has several strong traditions, and each leaves room for a different kind of product. Editors built on an engine give creators a full authoring environment. AI generators lead on turning an idea into a file or a clip. Specialist viewers carry augmented reality and distribution. Avatar tools have given people a face on many services. Agent frameworks are building the thinking half of the stack.

What we chose to build is the connection between them: a renderer that is open and browser-native, a model pipeline that ends in an open standard, and a body that agents can wear. The GLB file that a generator emits becomes something a language model can act on, because our MCP tools expose it as structured data (a scene graph, a skeleton, a set of expressions) and not as an opaque binary. That is why a ChatGPT connector can ask for a robot and get a model that opens in the same renderer described above. Our pages read their numbers live from the platform's own API, so what a page says and what the product does line up.

## The partners behind the renderer

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as it stands. The full map is at [three.ws/partners](https://three.ws/partners).

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free 3D Studio connector gives ChatGPT keyless 3D tools, and a Custom GPT Actions route reaches the same server, so the renderer in this article is what answers when ChatGPT is asked to show a 3D thing.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. The model and rigging stages run on NVIDIA GPUs (L4 and RTX PRO 6000 Blackwell on Cloud Run), and NVIDIA-hosted models serve a free text-to-3D lane, chat, vision and embeddings.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site and all of the API handlers, the GPU workers are their own Cloud Run services, Cloud Scheduler runs the recurring jobs, and Vertex AI provides Gemini lanes for text and images.

**IBM.** three.ws is an IBM Business Partner. Agents can think on IBM Granite foundation models served through IBM watsonx, and the Material Studio's chrome and gold restyles use Granite to propose PBR values. The user group on IBM Community held a nine-hour meetup inside a persistent three.ws 3D world that reached 3,145 avatars at its peak.

**Amazon Web Services.** three.ws is an AWS Partner, enrolled in the AWS Partner Network Software Path, with an AWS Marketplace integration built and deployed. We publish engineering write-ups on the AWS Builder Center.

**Alibaba Cloud.** three.ws is listed on the Alibaba Cloud International Marketplace, and Qwen models are lanes in the platform's model router.

**Quicknode.** three.ws is accepted into the Quicknode Startup Program, and Quicknode's RPC endpoints are a rung in the Solana failover chain.

**HackerNoon.** three.ws has partnered with HackerNoon, whose import picks up our announcements for its developer audience.

## How a change reaches your screen

A renderer improves when changes ship safely, so the process matters as much as the code. Each user-visible change is written, wired into the interface and exercised in a real browser before it counts as done, with a test beside it. A bug fix starts with a test that reproduces the bug and fails for the stated reason, then the fix, then the same test passing, committed together. Pre-push checks lint the rules, the commit subjects and the documentation. Deploys run one fixed sequence on Google Cloud: a clean worktree, the ordered build gates, Cloud Build, Cloud Run, a Cloud Scheduler sync for the recurring jobs and a CDN purge, then a smoke test against production. Each user-visible change gets a changelog entry, which a scheduled job delivers to our channels automatically. And the posts and articles we publish are themselves held to evidence: a feature is filmed against production before it is described, and a fact without a source does not go out.

## What is next

Here is what is on the roadmap, kept to what the work orders in the repository already name:

- **WebGPU and TSL.** The renderer is WebGL today. A WebGPU path is a planned work order for the next generation of effects.
- **Level of detail.** Automatic LOD generation so a distant avatar draws fewer triangles, which matters for crowded worlds.
- **Rig anything.** Widening the rigging worker to more body plans and the canonicaliser to more skeleton conventions, each added with a test.
- **TRELLIS.2 as the default lane** for image-to-3D, plus engine bridges and an AR viewer contract so `<agent-3d>` can place a model in a room.
- **Audio2Face and three-vrm** for richer faces and VRM avatars, and prompt-to-clip so a sentence becomes a motion.
- **Marketplaces and programmes.** The AWS Marketplace listing is built and waiting on product creation, the NVIDIA catalog submissions are in review, an OpenAI Cookbook contribution is submitted, and a Microsoft Azure Marketplace listing is on the roadmap.
- **A second IBM community event** is under consideration.

## Try it

Open the [live viewer](https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fa9694760-e134-4c5c-b334-59129a2d42c9.glb) on the lighthouse keeper from our Forge write-up and orbit him. Make your own model in the [Forge](https://three.ws/forge), no account needed to start. Check any file in [Rig Doctor](https://three.ws/rig-doctor) or the [validator](https://three.ws/validation). Browse the [Animation Gallery](https://three.ws/animations) and pose a skeleton in the [Animation Studio](https://three.ws/pose). Peel a foil sticker in [Holo](https://three.ws/holo). The embed documentation is at [three.ws/docs/web-component](https://three.ws/docs/web-component), and the 3D Studio connector for ChatGPT is on the [OpenAI page](https://three.ws/openai).
