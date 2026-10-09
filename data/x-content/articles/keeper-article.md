On the morning of 8 October we sent one sentence to the free three.ws MCP server: "an elderly lighthouse keeper in a yellow oilskin raincoat, navy knitted cap and black rubber boots, white beard". No account, no key. 197 seconds later the server answered with a rigged 3D character: 22,500 triangles, a 52-joint skeleton with every finger, 52 facial expression shapes, and a full PBR material. Four seconds after that he was a named persona with a stable id, and a third of a second after that he had spoken his opening line.

This is the whole pipeline behind that answer, followed one stage at a time on that one job: the rewrite, the picture, the mesh, the skeleton, the motion library, the persona and the web page. Every stage has a fallback behind it, and this run shows two of them doing their work. Every call, every timing and the server's own record of each job are written down in a run file that ships with the platform, so each number below can be checked against what the server said.

![The Keeper, generated from one sentence and auto-rigged on three.ws, standing in the live glTF viewer: an old man with a white beard, a navy knitted cap, a long yellow oilskin coat with flap pockets and dark buttons, blue trousers and black rubber boots](/x-media/keeper-article/cover.png)

## One call, five stages

The tool we called is forge_avatar, one of the free tools on the 3D Studio server. It takes a sentence or a reference image and returns a rigged, animation-ready GLB in one call. Inside that call, five things happen in order:

1. **A gate.** Auto-rigging assumes a biped, so a sentence that clearly names an object (a chair, a dog, a sword) is turned away before any GPU time is spent, with a message pointing to the mesh generator instead.
2. **A rewrite.** A director model turns the sentence into a brief a reconstruction model can use: the whole figure, head to toe, in a neutral A-pose, on a plain background.
3. **A picture.** An image model paints that brief as one reference picture.
4. **A mesh.** A reconstruction model on our own GPU rebuilds the picture as a textured 3D model.
5. **A skeleton.** A rigging worker on another GPU predicts joints and skin weights and writes them into the file.

On this run the mesh stage took 100 seconds and the rig stage 12.6 seconds. The rest of the 197 is everything around those two stages: rewriting the sentence, painting the picture, storing each intermediate file and polling the workers.

Any MCP client can make the same call. This is the request, sent over plain HTTP, with no headers beyond the content type:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"forge_avatar",
        "arguments":{"prompt":"an elderly lighthouse keeper in a yellow oilskin raincoat, navy knitted cap and black rubber boots, white beard"}}}'
```

## A brief that frames a full body

The sentence we typed says nothing about pose or framing. Left like that, a portrait-leaning model tends to answer a description of a person with a head and shoulders, and a bust cannot be rigged into anything that walks. So before anything is drawn, the sentence becomes a full-body brief.

A director model normally writes that brief. When the language models it calls are busy, a fixed brief is appended to the raw words instead, stating the framing the director would have asked for. On this run the fixed brief carried the job, and the server's own record shows the prompt the reconstruction lane received:

> an elderly lighthouse keeper in a yellow oilskin raincoat, navy knitted cap and black rubber boots, white beard, full-body character standing in a neutral A-pose, arms slightly away from the body, legs slightly apart, the entire figure in frame head to toe, centered on a plain neutral background

The comment above it in the code says what it is for: a busy language model chain costs polish, never the body. With that brief in place, a call to forge_avatar yields a figure that is whole, upright and ready to rig.

## A picture comes before the shape

The reconstruction models that build meshes read images, not sentences. So the brief is painted before anything is built, as one centered subject on a plain seamless background under soft even light. The realism of the final mesh is set almost entirely by the realism of that one reference picture, which is why this stage has its own ladder of providers. A Gemini image model on Vertex AI leads it, because it draws the most photoreal reference. On this run the picture came from FLUX.1-dev, the next rung down, so the ladder delivered a reference picture without waiting on any single provider.

![Left, the reference picture FLUX.1-dev painted from the brief: the keeper standing in an A-pose on a pale background, a clean full-length reference. Right, four frames of the finished model rendered by the server from the front, three-quarter, side and back, showing the coat's hood, cuffs and back seam that the picture did not show](/x-media/keeper-article/picture-to-model.png)

The model came out clean, and the back of the coat, which no picture showed, was filled in by the reconstruction: a hood, a center seam and turned-back cuffs that match the front.

## The picture becomes a mesh

Avatars ask for the high tier, and at the high tier the router sends a job to Hunyuan3D 2.1 on our own worker, a Cloud Run service with an NVIDIA RTX PRO 6000 Blackwell attached. Hunyuan3D 2.1 builds the geometry, then runs a separate pass that paints a full PBR material set rather than one baked colour map. The keeper came back with one material carrying four maps: base colour, metallic and roughness, normal, and ambient occlusion. The coat reads as waxed cloth under a light because of the normal and roughness maps, not because of anything painted into the colour.

The mesh is 22,500 triangles across 16,388 vertices, sized for a character that has to render in a browser next to other things. Behind that engine sits a rescue order that keeps a job alive under the same job id: our own TRELLIS worker, a hosted TRELLIS lane, then TripoSG. Hunyuan3D 2.1 carried this run on its own, and the full chain is described in our write-up on the Forge.

## A skeleton in 12.6 seconds

A mesh is a statue. To move, it needs joints, and each vertex needs to know how much each joint pulls on it. The rig stage sends the mesh to our rigging worker, a Cloud Run service on an NVIDIA L4 running Make-It-Animatable, an open model released under the MIT licence and published at CVPR 2025.

The model predicts joint positions, skinning weights and pose for a 52-bone Mixamo skeleton, fingers included, in under a second of GPU time. It is used as a predictor and nothing more. The worker then writes the skeleton, the per-vertex joint indices and weights, and the inverse bind matrices straight into the original GLB bytes, so the mesh does not pass through a converter, and its materials and PBR textures are preserved byte for byte. A third step transfers the 52 ARKit expression shapes from an open template head onto the avatar's face, written as glTF morph targets. Those shapes are what a face needs to blink, frown, smile and move its mouth.

We checked the result in Rig Doctor, the free page that diagnoses a GLB in the browser without uploading it. Every limb group mapped:

![Rig Doctor's report on the keeper: coverage of 52 of 52 canonical joints, with Torso 6 of 6, Arms 8 of 8, Hands 30 of 30 and Legs 8 of 8 all marked Will animate, and an inventory reading Mixamo convention, 22,500 triangles, 52 joints, 1 material, 52 blendshapes and a 14.2 MB file](/x-media/keeper-article/rig-doctor.png)

## One skeleton, a whole motion library

The keeper's bones are named the Mixamo way, mixamorig:LeftForeArm and so on. The motion library is not. Every clip in it is authored against one canonical skeleton: Hips, LeftForeArm, RightUpLeg, 52 joints in total. A clip does not store a body. It stores tracks, and each track names the joint it turns, so a track that names LeftForeArm drives nothing on a rig that spells it differently.

Before a clip touches an avatar, a canonicalizer strips vendor prefixes and namespaces, collapses separators and case, and looks what is left up in alias tables that cover more than twenty naming schemes. The rig worker's Mixamo names map onto the canonical set one to one, so a freshly rigged avatar drives the clip library at 100% coverage. Hands matter more than they look here: fingers are 30 of the clip library's 53 tracks, and a rig whose hands do not map scores about 40% coverage and gets no animation at all. That is why the 30 of 30 in the report above is the line that counts.

A matching name is half the job. The reference rig the clips were baked on rests in an A-pose, and Mixamo rigs rest in a T-pose, so copying rotations across as they are would play every limb in the wrong frame. The retargeter reads each joint's rest rotation on the target and replays the clip bone's motion as the same change in world space from that rest. Joint rotations and the root translation cross over, the bone lengths baked into the clips do not, and the root is rescaled to the new rig's height, so a body keeps its own proportions instead of being stretched into the reference one.

## A body becomes a persona

A GLB on a CDN is a file. An agent needs an identity that outlives the conversation that made it. create_agent_persona took the keeper's GLB and a name, copied the model into durable storage so the body survives the source URL expiring, and registered it under a stable id. It answered in 4.1 seconds:

> Saved "The Keeper" as a living persona.
> Rig: humanoid, full body animation + lip-sync.

That id is the handle. Pass it to get_agent_persona in a later session and the same body and name come back, with the number of turns it has spoken so far. Pass it to persona_say with the text the agent is saying, and the body performs the line: lip-sync, a facial expression and a gesture, with the emotion detected from the text unless the caller sets one. We gave him one line:

> Forty years I kept this light. Every ship that saw it made it home, and I am glad you found your way here too.

persona_say answered in 299 milliseconds and recorded the turn. The emotion is detected from the text unless the caller sets one, so an app that wants a specific tone can pass it with the line.

## The same body on any web page

A rigged GLB at a public address is all the web component needs. Two lines put the keeper on any page:

```html
<script type="module" src="https://three.ws/agent-3d/1/agent-3d.js"></script>
<agent-3d body="https://three.ws/cdn/forge/anon/a9694760-e134-4c5c-b334-59129a2d42c9.glb"></agent-3d>
```

There is no API key and no build step. The element boots once it comes within 300 pixels of the viewport, loads the body and the idle and walk clips, retargets them onto the keeper's skeleton, and keeps its canvas hidden until that pose has rendered, so a bind pose is not what a visitor sees. Browsers cap live WebGL contexts at around 16 in Chrome, so by default eight avatars are live at a time, and one scrolled out of view hands its context back until it returns. A visitor who asks the operating system for reduced motion gets a single held idle pose instead of a loop.

## Three front doors, one handler

The request above went to the 3D Studio server, and the same fourteen tools are reachable three ways over one shared handler and one shared generation quota. The main address serves all fourteen tools, the 3D tools, the asset catalog and the persona tools, to any MCP host including a ChatGPT developer-mode connector. A second address serves the nine 3D tools and the model viewer for the ChatGPT plugin directory. A third serves all fourteen tools to Grok Bot, Grok connectors and the xAI Responses API, with every call answered within 40 seconds.

Each generation tool renders its result inline in an interactive 3D viewer widget, so in ChatGPT the keeper appears as a model you can turn around inside the conversation. The viewer's content security policy allowlists exactly two origins, and the widget re-serves every off-origin GLB through the platform so nothing loads from an unexpected host. One definition of what each door advertises keeps the three in step.

## Open models, credited

The skeleton stage builds on open research. Make-It-Animatable, released under the MIT licence and published at CVPR 2025, predicts the joints and weights. The 52 ARKit expression shapes come from the ICT-FaceKit template head, also MIT licensed, transferred onto the avatar's head by nearest-surface correspondence with distance falloff and written as glTF morph targets with their names. Every rig task runs under a hard timeout of 420 seconds by default, so a task finishes or reports back and a poller does not wait on a job that has stopped.

## The partners behind the pipeline

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as it stands. The full map is at [three.ws/partners](https://three.ws/partners).

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. Both GPU stages in this article ran on NVIDIA hardware: the mesh on an RTX PRO 6000 Blackwell, the skeleton on an L4. NVIDIA-hosted models on NIM serve chat, vision and embeddings elsewhere on the platform.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site and every API handler, the GPU workers are their own Cloud Run services, Cloud Scheduler runs the jobs, and Vertex AI provides the Gemini and image lanes at the top of the model chain.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free 3D Studio connector that served this run gives ChatGPT eleven keyless 3D tools, and the same server is listed on the Official MCP Registry, so any MCP client can reach it.

**IBM.** three.ws is an IBM Business Partner. Agents on three.ws can think on IBM Granite foundation models served through IBM watsonx, so a persona like the keeper can speak with an enterprise model behind it.

**Amazon Web Services.** three.ws is an AWS Partner, with an AWS Marketplace integration built and deployed. We publish engineering write-ups on the AWS Builder Center.

**Alibaba Cloud.** three.ws is listed on the Alibaba Cloud International Marketplace, and Qwen models are lanes in the platform's model router.

**Quicknode.** three.ws is accepted into the Quicknode Startup Program, and Quicknode's RPC endpoints are a rung in the Solana failover chain behind agent wallets.

**HackerNoon.** three.ws has a builder-focused publishing partnership with HackerNoon, whose import picks up our announcements for its developer audience.

## Try it

The browser version of this pipeline is at [three.ws/create/prompt](https://three.ws/create/prompt): type a description and get a rigged avatar back. The MCP server, its tools and its quotas are documented on the [3D Studio MCP page](https://three.ws/docs/mcp-studio). [Rig Doctor](https://three.ws/rig-doctor) diagnoses any GLB in your browser without uploading it, and the keeper himself is in the [live viewer](https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fa9694760-e134-4c5c-b334-59129a2d42c9.glb), where you can turn him around and download him.
