We gave the Forge, three.ws's 3D model generator, one picture and no account, and 2 minutes 17 seconds later it handed back a textured 3D model and a signed receipt describing exactly how it got there. The picture was a screenshot of a noir detective in a trench coat and fedora, taken from the public model page of an earlier draft. The model that came back is the same detective, rebuilt as geometry with a colour texture, and I can turn him around in the viewer.

The receipt is the useful part of this story. It names the engine that did the work, the stage that took the time, and the one step where a fallback carried the job. This article follows that single run from the request to the receipt, and uses it to explain how the Forge's mesh engines are arranged: the picture that comes before the shape, the engine ladder for each quality tier, the rescue that moves a job to a new engine mid-flight, and the free lane that needs no key.

![The delivered model in the three.ws viewer: the detective from the input picture rebuilt as a textured mesh, seen from the side with his hat, long black coat and white gloves, with Download GLB and Do more with this model buttons below](/x-media/forge-article/delivered-model.png)

## One picture in, one signed receipt out

The run went through the free 3D Studio connector, which any MCP client can call without a key. The call is one JSON-RPC message to the `mesh_forge` tool, with the picture as `image_url`. The tier was left at its default, Standard.

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mesh_forge","arguments":{
         "image_url":"https://three.ws/x-media/forge-article/hunyuan-detective.png"}}}'
```

The reply carries the finished GLB, a viewer link and a receipt id, `rr_9Wc3cwxCbevEWfbbY2F3BN`. The input picture was this one:

![The input picture: the public model page of a noir detective in a belted trench coat and fedora, with the model information panel reading Engine hunyuan3d, 4 textures, 1 mesh, 30k triangles and glTF valid](/x-media/forge-article/hunyuan-detective.png)

Here is the receipt in summary form, copied from the signed record. The Mesh stage accounts for almost the whole run, which is where a reconstruction model does its work.

| Stage | Verdict | What the record says |
| --- | --- | --- |
| Input | Met | Received a reference image; it passed the safety check |
| Brief | Skipped | A reference image was supplied, so it was used directly |
| Mesh | Met | A mesh from the standard tier on TRELLIS (self-host), 137,423 ms |
| Geometry check | Skipped | No geometry score was reported for this file |
| Visual check | Skipped | This tier does not run the vision check |
| Delivery | Recovered | The file was served from the engine's own link |

Three things in that table shape the rest of the article. The Brief stage was skipped because a photo is already a reference, so the step that paints a picture did not run. The Mesh stage names its engine, TRELLIS on our own worker. And Delivery is marked Recovered, with the plain-words cause recorded on the receipt page. The whole run lasted 137,433 ms, so the mesh stage was 137,423 ms of it.

## A picture comes before the shape

The reconstruction models that build the mesh read an image, not a sentence. When you type a prompt instead of uploading a photo, the Forge first writes the picture. The prompt is rewritten and painted as one centered subject on a plain seamless background, under soft even light, with real-world materials. The realism of the final mesh is set almost entirely by the realism of that one reference image: a clean, photoreal picture reconstructs into a model that looks real, and a cluttered or cartoonish one does not.

The picture has its own ladder. A Gemini image model on Vertex AI leads, because it draws the most photoreal reference. If that lane is unavailable, the request falls through to FLUX on NVIDIA's hosted inference, then to further providers, ending in a keyless rung, so no single provider's failure is ever the terminal error for the picture.

Photos skip this step: your photo is the reference. A sketch skips it too, and goes to a model built to read drawings. That is why the Brief stage in our receipt reads Skipped, and why a prompt run and a photo run produce receipts with the same shape.

The Forge page puts the choice at the top: Describe it, From photos, From a sketch. The engine row underneath is where the next section starts.

## Which engine builds the shape

A quality tier sets the polygon budget, and the router picks a lane for the tier. The live catalog publishes both, so the table below is read from `/api/forge?catalog` rather than from documentation.

| Tier | Polygon budget | Default image engine |
| --- | --- | --- |
| Draft | about 12,000 | TRELLIS (self-host) |
| Standard | about 30,000 | TRELLIS (self-host) |
| High | up to 200,000 | TRELLIS (self-host) |

High also turns on PBR materials and HD textures in the tier definition, which is the setting that matters when an engine with a PBR paint pass is selected. The default engine at every tier is TRELLIS on our own NVIDIA L4 worker, and our receipt shows the Standard path doing exactly that.

Before a job starts, the router reads lane health. It takes the first lane in its order that is healthy or whose state is unknown; if none is clean, it takes the first that is not confirmed down. Our own GPU workers sit at the front of every order, because a lane on our own hardware has no vendor cost. Behind them sit free external lanes: Hugging Face Spaces for photos, and NVIDIA's hosted TRELLIS for text, which keeps a text prompt answerable even when every one of our GPU workers is cold.

![The engine picker on the Forge: TRELLIS selected and marked free, with NVIDIA, both Hunyuan3D lanes, and engines that take your own key beside it, a legend for busy and unavailable lanes, and the line "Standard · Free · usually ~60s · renders a preview image, then builds 3D"](/x-media/forge-article/engines.png)

The picker is the same list the router uses, drawn for a person. A green Free badge means no API key. A key icon means the engine runs on your own key. Engines that need your own API key run only when you pick them; the router leaves them out of its automatic choice. The line under the picker states the expectation for the chosen tier: Standard, usually about a minute. Our run took 2 minutes 17 seconds, and the receipt shows where that time went, which is the point of keeping a receipt.

The roster behind that picker, read from the same catalog, looks like this:

| Engine | Runs on | Key needed |
| --- | --- | --- |
| TRELLIS (self-host) | our own NVIDIA L4 worker on Cloud Run | no |
| Hunyuan3D 2.1 (self-host) | our own RTX PRO 6000 Blackwell worker | no |
| Hunyuan3D / TRELLIS Spaces | Hugging Face Spaces, photos | no |
| TRELLIS on NIM | NVIDIA's hosted inference, text only | no |
| TripoSG (self-host) | our own worker, geometry only | no |
| Meshy 6, Tripo v3.1, Rodin | the vendor's service | your own key |
| Stable Fast 3D, Replicate | the vendor's service | your own key |

Hunyuan3D 2.1 is the engine with a PBR paint pass. It generates the shape with one network and then paints colour, roughness and normal maps with a second, rather than a single baked colour map. It runs on our own worker on an RTX PRO 6000 Blackwell, and it is licence aware. Its community licence does not cover the European Union, the United Kingdom or South Korea, so the router resolves the country on the server and keeps every Tencent lane out of those regions. When a request names that engine from a region its licence excludes, the answer is a structured `region_restricted` response that points to the lane that is available everywhere:

```json
{"error":"region_restricted","backend":"hunyuan3d",
 "message":"This engine is not available in your region because its model licence excludes it. Use the default engine, which is available everywhere.",
 "retry_backends":["trellis_selfhost"]}
```

We received that answer while testing the Hunyuan3D lane by name from our own network, and the retry list pointed straight at the default engine. The response is a designed outcome with a next step in it.

## A job keeps its id when a lane hands it on

A refusal at submit time is the easy case: the request walks the chain until a lane accepts it. The harder case is a worker that accepts a job and then fails it minutes later, when the request that started it is long gone.

That hand-off happens on the next status poll. The poll handler marks the failed lane unhealthy for 90 seconds, so new jobs steer around it at once. Then it recovers the original prompt and the stored reference picture from the job's record, resubmits them to the next lane, and binds the old job id to the new one. The page keeps polling the same id and sees the job still running, now on a different engine, and you keep watching the same progress bar.

The ordering policy for that rescue is the same one the router uses: our own GPU workers first, then free external lanes, then the paid platform default, then the geometry-only TripoSG lane as the final rung. A job gets its first lane plus up to three backups. TripoSG closes the chain because it returns an untextured mesh, so it runs only once every textured lane has failed or is marked down. That trade is deliberate: a shape you can keep is a better ending than a hard stop.

The numbers that govern a rescue fit in one table:

| Setting | Value | Why it exists |
| --- | --- | --- |
| Lane cooldown after a failure | 90 seconds | New jobs steer around the lane at once |
| Backup lanes per job | up to 3 | A job gets its first lane plus three more tries |
| Last rung | TripoSG | An untextured shape beats a hard stop |
| Health probe timeout | 4 seconds | The public status view stays quick |
| Task state | object storage | Any instance can answer a poll |

When nothing is left to try, the response still names the way forward. It lists the lanes that can serve a fresh retry, so the page can offer a one-click switch of engine. Two kinds of lane are suggestions only, because of how they work: Hugging Face Spaces block for the whole generation, and NVIDIA's hosted lane takes text only, so neither can pick up a job from a status poll. A rescue rebuilds from the one stored reference picture, so a job that started from several photos continues from one of them, and says so by reporting how many views it used.

## The GPU workers on Cloud Run

Each self-hosted lane is its own Cloud Run service: a small Python worker wrapping one model, with an NVIDIA GPU attached. TRELLIS runs on an L4. Hunyuan3D 2.1 runs on an RTX PRO 6000 Blackwell, held warm with one instance, because a cold start means loading 14 GiB of weights before any work begins. Every worker speaks the same contract, which is what lets the router treat them as interchangeable rungs.

This is what the TRELLIS worker returned when we asked its health endpoint while writing this:

```json
{"ok": true, "model": "trellis-image-large", "gpu_available": true,
 "gpu_name": "NVIDIA L4", "pipeline_loaded": true, "ready": true,
 "load_error": null, "load_attempts": 1,
 "tiers": ["draft", "standard", "high", "max"],
 "default_quality": {"ss_steps": 40, "slat_steps": 40, "ss_cfg": 7.5,
                     "slat_cfg": 3.0, "simplify": 0.75, "texture_size": 4096},
 "rembg_matte": true, "output_backend": "gcs"}
```

Two fields carry the design. `ok` means the process is up; `ready` flips only when the model has loaded. A worker that opens its port before the model loads would otherwise look healthy while it is still starting. The Forge's health check reads the second field, so a worker that is up but still loading is reported degraded, not healthy, with the note that a generation will queue until it is ready. Task state lives in object storage rather than in the instance, so a job submitted to one autoscaled instance and polled on another still resolves. Each probe waits 4 seconds for an answer, which keeps the public status view quick.

The same lane list is public. This is the part of `/api/forge?health=1` that describes the workers behind our run:

```json
"trellis_selfhost": {"status": "ok", "message": "The TRELLIS (self-host) worker is reachable."},
"hunyuan3d":        {"status": "ok", "message": "The Hunyuan3D worker is reachable."},
"triposg":          {"status": "ok", "message": "The TripoSG worker is reachable."}
```

The Blackwell move taught us two things worth passing on. Cloud Run backs /tmp with RAM, so weights staged there and weights loaded into the process are charged to the same memory budget: 18 GiB staged plus 14 GiB loaded is a 32 GiB peak, and the RTX PRO 6000 tier's floor of 80 GiB clears it with room to spare. And Blackwell needs its GPU code built with NVIDIA's 12.8 toolkit. The worker image compiles its extensions for both GPU generations, so which card runs it is a deploy flag rather than a rebuild. The full field report is on the blog.

## Check the run yourself with the signed receipt

Every generation writes a run receipt: what each stage was expected to do, what it observed, and a verdict, signed with an ed25519 key. The receipt for our run is public at `/runs/rr_9Wc3cwxCbevEWfbbY2F3BN`, and the same JSON is at `/api/runs?id=rr_9Wc3cwxCbevEWfbbY2F3BN`.

![The Every stage list on the receipt page: Input Met, Brief Skipped, Mesh Met with the tier standard and engine TRELLIS (self-host) chips, Geometry check Skipped, Visual check Skipped, and Delivery Recovered with its cause](/x-media/forge-article/run-receipt-stages.png)

Skipped is a verdict with a reason, not a blank. Recovered names the cause of the fallback in plain words. The page then re-verifies the signature on the server and shows the four checks it ran.

![The Signature verified panel: four ticks for shape, hash, signature and signer, the sha256 and signer key, and the command that checks the receipt offline](/x-media/forge-article/run-receipt-signature.png)

The receipt carries a sha256 of its canonical form and the signer's public key, so a stranger can verify it without trusting the page. The panel prints the command, and the script needs nothing but the JSON:

```bash
node scripts/run-receipt-verify.mjs rr_9Wc3cwxCbevEWfbbY2F3BN \
  --signer Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH
```

The aggregate view at `/api/runs?stats=1&days=7` counts outcomes and stage verdicts across every receipt in the window, with no prompt, file or id in it. That is the quickest way to see which stages are carrying the load across all the lanes.

## Call the free lane from any MCP client

The connector behind our run lists the keyless tools. The ones that touch meshes are `forge_free` for text, `mesh_forge` for text or a reference image, `rig_mesh` for adding a skeleton to a static model, `look_at_model` for rendering a GLB from several angles, and `check_job` and `get_job` for collecting a job that returned pending. A pending job returns an id and the status moves through queued and running to done or failed. The REST surface behind the Forge page takes the same fields:

```bash
# start a job: a prompt or image_urls, a tier, an optional engine and path
curl -s -X POST https://three.ws/api/forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a brass compass, weathered","tier":"draft"}'
# -> {"job_id":"f1.…","status":"queued","eta_seconds":…,"reference_image_urls":[…]}

# poll the same id until it settles
curl -s "https://three.ws/api/forge?job=f1.…"

# read the tiers, engines and defaults the page renders
curl -s "https://three.ws/api/forge?catalog"
```

Because the poll handler does the rescue, the id you hold stays valid across engines. A client does not need to know a failover happened, and can read the backend field if it wants to.

## Open models, credited

The mesh engines rest on open research and open weights. TRELLIS, the model behind our run, is Microsoft's structured-latent 3D generator, published at CVPR 2025 and released under the MIT licence; our worker runs the TRELLIS-image-large checkpoint. Hunyuan3D 2.1 is Tencent's shape and PBR texture model, released under the Tencent Hunyuan Non-Commercial licence, which is why the worker runs self-hosted inference on our own GPUs, returns only generated files, and honours the territory clause described above. TripoSG, the geometry-only rung at the end of the rescue chain, comes from VAST AI Research under the MIT licence. The picture ladder uses Google's Gemini image models on Vertex AI and FLUX models served on NVIDIA's hosted inference. Thank you to every one of those teams for publishing the work.

## The partners behind the Forge

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as it stands. The full map is at [three.ws/partners](https://three.ws/partners).

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. The mesh in our run was built on an NVIDIA L4, the Hunyuan3D lane runs on an RTX PRO 6000 Blackwell, and NVIDIA's hosted inference serves the free text lane and the FLUX rung of the picture ladder.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site and every API handler, each GPU worker is its own Cloud Run service, and Vertex AI provides the Gemini image lane at the top of the picture ladder.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free 3D Studio connector that served this run gives ChatGPT keyless 3D tools, and the same server is listed on the Official MCP Registry, so any MCP client can reach it.

**IBM.** three.ws is an IBM Business Partner. Agents on three.ws can think on IBM Granite foundation models served through IBM watsonx, so a model from the Forge can become the body of an agent with an enterprise model behind it.

**Amazon Web Services.** three.ws is an AWS Partner. We publish engineering write-ups on the AWS Builder Center.

**Alibaba Cloud.** three.ws is listed on the Alibaba Cloud International Marketplace, and Qwen models are lanes in the platform's model router.

**Quicknode.** three.ws is accepted into the Quicknode Startup Program, and Quicknode's RPC endpoints add redundancy to the chain access behind agent wallets.

**HackerNoon.** three.ws has partnered with HackerNoon, a builder-focused publishing partnership whose import picks up our announcements for developers.

## Try it

Open the [Forge](https://three.ws/forge), type a sentence or drop in a photo, and pick an engine or leave the router to choose; a Draft or Standard model is free and needs no account. The detective from this article is in the [live viewer](https://three.ws/viewer?src=https%3A%2F%2Fstorage.googleapis.com%2Fthree-ws-avatar-reconstructions%2Fraw-meshes%2Ftrellis%2Fc58a25a1-7e8e-48bf-80d0-3403a68cf19a.glb&title=3D%20model), and the [signed receipt for the run](https://three.ws/runs/rr_9Wc3cwxCbevEWfbbY2F3BN) shows every stage. The lane status the engine picker reads is public at [/api/forge?health=1](https://three.ws/api/forge?health=1), the tools are documented on the [3D Studio MCP page](https://three.ws/docs/mcp-studio), and the GPU field report behind the Blackwell move is [on the blog](https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell).
