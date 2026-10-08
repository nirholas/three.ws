On the morning of 8 October we sent one sentence to the free three.ws MCP server: "an elderly lighthouse keeper in a yellow oilskin raincoat, navy knitted cap and black rubber boots, white beard". No account, no key. 197 seconds later the server answered with a rigged 3D character: 22,500 triangles, a 52-joint skeleton with every finger, 52 facial expression shapes, and a full PBR material. Four seconds after that he was a named persona with a stable id, and a third of a second after that he had spoken his opening line.

This is the whole pipeline behind that answer, followed one stage at a time on that one job: the rewrite, the picture, the mesh, the skeleton, the motion library, the persona and the web page. We kept the parts that went wrong, because two did, and they show what each stage is for better than the parts that went right. Every call, every timing and the server's own record of each job are written down in a run file that ships with the platform, so each number below can be checked against what the server said.

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

## The rewrite failed, and the fallback did its job

The sentence we typed says nothing about pose or framing. Left like that, a portrait-leaning model tends to answer a description of a person with a head and shoulders, and a bust cannot be rigged into anything that walks. So before anything is drawn, a director model rewrites the sentence into a full-body brief.

On this run the director did not answer. The language models it calls were rate limiting at that moment, and the rewrite came back empty. That case is designed for. When the director fails, a fixed fallback brief is appended to the raw words, stating the framing the director would have asked for. The server's own record of the job shows the prompt the reconstruction lane received:

> an elderly lighthouse keeper in a yellow oilskin raincoat, navy knitted cap and black rubber boots, white beard, full-body character standing in a neutral A-pose, arms slightly away from the body, legs slightly apart, the entire figure in frame head to toe, centered on a plain neutral background

That is the fallback, word for word. The comment above it in the code says what it is for: an outage on the language model chain costs polish, never the body. On this run it was the difference between a rigged character and a bust.

## A picture comes before the shape

The reconstruction models that build meshes read images, not sentences. So the brief is painted before anything is built, as one centered subject on a plain seamless background under soft even light. The realism of the final mesh is set almost entirely by the realism of that one reference picture, which is why this stage has its own ladder of providers. A Gemini image model on Vertex AI leads it, because it draws the most photoreal reference. This morning that rung was refusing requests, so the picture came from FLUX.1-dev, further down the ladder. No single provider's failure is the end of a picture.

![Left, the reference picture FLUX.1-dev painted from the brief: the keeper standing in an A-pose on a pale background, slightly soft. Right, four frames of the finished model rendered by the server from the front, three-quarter, side and back, showing the coat's hood, cuffs and back seam that the picture did not show](/x-media/keeper-article/picture-to-model.png)

The picture is a little soft, which is what a lower rung costs. The model still came out clean, and the back of the coat, which no picture showed, was filled in by the reconstruction: a hood, a center seam and turned-back cuffs that match the front.

## The picture becomes a mesh

Avatars ask for the high tier, and at the high tier the router sends a job to Hunyuan3D 2.1 on our own worker, a Cloud Run service with an NVIDIA RTX PRO 6000 Blackwell attached. Hunyuan3D 2.1 builds the geometry, then runs a separate pass that paints a full PBR material set rather than one baked colour map. The keeper came back with one material carrying four maps: base colour, metallic and roughness, normal, and ambient occlusion. The coat reads as waxed cloth under a light because of the normal and roughness maps, not because of anything painted into the colour.

The mesh is 22,500 triangles across 16,388 vertices, sized for a character that has to render in a browser next to other things. If the worker had failed partway, the job would have moved to the next engine under the same job id: our TRELLIS worker, a hosted TRELLIS lane, then TripoSG. That chain was not needed on this run, and it is described in full in our write-up on the Forge.

## The attempt before, and why the assistant needs to look

The keeper above is not our opening attempt. Before calling forge_avatar we called forge_free, the plain text-to-model tool, at the high tier, with a longer sentence of our own. It returned a model in 108 seconds. It looked like a success from the outside: a file, a link, a reference picture.

Then we called look_at_model on it. That tool renders any public GLB on the server from several angles and returns the frames as images, so an assistant can see what it made instead of handing over a link it cannot check. The frames showed the problem at once: a small figure standing in a cloud of floating specks, scattered far enough from the body that the camera had to pull back to fit them all in. The geometry count agreed: 8,464 triangles.

![Left, the reference picture from the earlier forge_free attempt, visibly blurred. Right, the server's three-quarter render of the model built from it: a tiny figure surrounded by dozens of floating specks of stray geometry, framed so wide the figure is barely visible](/x-media/keeper-article/first-attempt.png)

The text that comes back with those frames asks the model three questions: is the subject complete and recognisable, is the far side finished, is anything melted, fused or missing. Then it tells the model to generate again with a prompt that names the specific fault. That turns one-shot generation into a loop an assistant can run by itself, and it is the loop we ran: we looked, we saw a soft picture and stray geometry, and we went to the tool whose rewrite frames a full figure. look_at_model is marked read-only. It changes nothing on the server, and it works on any public GLB, wherever it was made.

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

persona_say answered in 299 milliseconds and recorded the turn. It read the line as neutral. We would have called it warm, which is a fair note on what automatic emotion detection does with a quiet sentence: when the tone matters, set the emotion yourself.

## The same body on any web page

A rigged GLB at a public address is all the web component needs. Two lines put the keeper on any page:

```html
<script type="module" src="https://three.ws/agent-3d/1/agent-3d.js"></script>
<agent-3d body="https://three.ws/cdn/forge/anon/a9694760-e134-4c5c-b334-59129a2d42c9.glb"></agent-3d>
```

There is no API key and no build step. The element boots once it comes within 300 pixels of the viewport, loads the body and the idle and walk clips, retargets them onto the keeper's skeleton, and keeps its canvas hidden until that pose has rendered, so a bind pose is not what a visitor sees. Browsers cap live WebGL contexts at around 16 in Chrome, so by default eight avatars are live at a time, and one scrolled out of view hands its context back until it returns. A visitor who asks the operating system for reduced motion gets a single held idle pose instead of a loop.

## What went wrong, and what it does not do yet

Two parts of this run went wrong, and we have described both above: the director's rewrite failed, and the lead picture rung refused requests. Neither stopped the job, because both stages have a fallback. The earlier attempt went wrong in a way no fallback catches, a model full of stray geometry that no status code reported and one look revealed. That is the case for look_at_model, and also its limit: the tool shows an assistant the problem, and someone still has to decide to try again.

There is one defect we have to state plainly. On the live site today, the keeper's idle drives his upper arms back through his coat. Rig Doctor's preview shows it, and so does the web component. The cause is in the retargeter: a rig that rests in an A-pose with bent elbows received the idle's full swing down from a T-pose on top of an arm that already hung down. The fix re-aims each limb from its own rest direction onto the authoring rig's before the clip plays. It is written and committed, and on the build that carries it the keeper's arms hang at his sides. It reaches three.ws with the next deploy. Until then the images in this piece show him in his rest pose, not mid-idle, because a still of the broken idle would show you a defect and a still from an unreleased build would show you something the live site does not do yet.

Rig Doctor also undersells him. It reports that the keeper has no viseme blendshapes and so "cannot lip-sync", because its check looks for the 15 Oculus viseme names and no other set. The keeper carries the 52 ARKit shapes instead, which is the set the rig worker writes and the set the persona tools drive. The check needs to learn the second vocabulary.

Fine detail is where reconstruction still struggles. The keeper's face holds together and reads as an old man, and it does not survive close inspection: the beard is one sculpted mass, not hair. The free server is rate limited per IP address, at four generations a minute and 30 an hour, and look_at_model counts against the same quota because it renders on the server.

## Try it

The browser version of this pipeline is at [three.ws/create/prompt](https://three.ws/create/prompt): type a description and get a rigged avatar back. The MCP server, its tools and its quotas are documented on the [3D Studio MCP page](https://three.ws/docs/mcp-studio). [Rig Doctor](https://three.ws/rig-doctor) diagnoses any GLB in your browser without uploading it, and the keeper himself is in the [live viewer](https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fa9694760-e134-4c5c-b334-59129a2d42c9.glb), where you can turn him around and download him.
