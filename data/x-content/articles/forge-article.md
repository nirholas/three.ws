Type a sentence into the Forge and two chains run one after the other: the first paints a reference picture of the object, the second reconstructs that picture into a textured GLB. Each chain has backup rungs, so when an engine fails partway through a job, the job moves to the next engine under the same job id and the progress bar keeps going. The first rungs are our own NVIDIA GPU workers on Google Cloud Run, and a Draft or Standard model costs nothing and needs no account.

## A picture comes before the shape

The reconstruction models that build the mesh read an image, not a sentence. So a text prompt is first rewritten and painted as one centered subject on a plain seamless background, under soft even light, with real-world materials. The realism of the final mesh is set almost entirely by the realism of that one reference image: a clean, photoreal picture reconstructs into a model that looks real, and a cluttered or cartoonish one does not.

The picture has its own ladder. A Gemini image model on Vertex AI leads, because it draws the most photoreal reference. If it fails, the request falls through to FLUX on NVIDIA's hosted inference, then to further providers, ending in a keyless rung, so no single provider's failure is ever the terminal error for the picture.

Photos skip this step: your photo is the reference. A sketch skips it too, and goes to a model built to read drawings.

![The engine picker on the Forge: TRELLIS selected and marked free, with NVIDIA, both Hunyuan3D lanes, and engines that take your own key beside it, a legend for busy and unavailable lanes, and the line "Standard · Free · usually ~60s · renders a preview image, then builds 3D"](/x-media/forge-article/engines.png)

## Which engine builds the shape

The router picks a lane per quality tier. Draft and Standard go to TRELLIS on our own worker. High goes to Hunyuan3D 2.1 on our own worker, which paints a full PBR material set (colour, roughness and normal maps) rather than one baked colour map. At the High tier, a prompt that clearly reads as a hard-surface object (a robot, a vehicle, a piece of furniture) swaps TRELLIS ahead of Hunyuan3D, because single-hop reconstruction is crisper on mechanical shapes.

Behind our own workers sit free external lanes: Hugging Face Spaces for photos, and NVIDIA's hosted TRELLIS for text, which keeps a text prompt answerable even when every one of our GPU workers is cold. Engines that need your own API key run only when you pick them, and the engine picker lets you name any lane yourself instead of taking the router's choice.

Before a job starts, the router reads lane health. It takes the first lane in its order that is healthy or simply unknown; if none is clean, it takes the first that is not confirmed down. The tiers set the polygon budget: about 12,000 at Draft, about 30,000 at Standard, and up to 200,000 at High.

## When a lane fails in the middle of a job

Failure at submit time is the easy case: the request walks the chain until a lane accepts it. The harder case is a worker that accepts a job and then fails it minutes later, when the request that started it is long gone.

That failure surfaces on the next status poll. The poll handler marks the failed lane unhealthy for 90 seconds, so new jobs steer around it at once. Then it recovers the original prompt and the stored reference picture from the job's record, resubmits them to the next lane, and binds the old job id to the new one. The page keeps polling the same id and sees the job still running, now on a different engine.

The order for that rescue is our TRELLIS worker, then our Hunyuan3D worker, then a hosted TRELLIS lane where one is configured, then TripoSG. A job gets its first lane plus up to three backups. TripoSG closes the chain because it returns an untextured mesh, so it runs only once every textured lane has failed or is marked down. It earned its place during a worker outage from 18 to 28 September that took Hunyuan3D and TRELLIS down together: without it, roughly 400 photo jobs a day ended in a hard failure while the TripoSG worker sat healthy.

When nothing is left to try, the failure still is not a dead end. The response names the lanes that can serve a fresh retry, so the page can offer a one-click switch of engine.

## The GPU workers on Cloud Run

Each self-hosted lane is its own Cloud Run service: a small Python worker wrapping one model, with an NVIDIA GPU attached. TRELLIS runs on an L4. Hunyuan3D 2.1 runs on an RTX PRO 6000 Blackwell, held warm with one instance, because a cold start means loading 14 GiB of weights before any work begins. Every worker speaks the same contract, which is what lets the router treat them as interchangeable rungs. The first two lines below are that contract; the health answer is what the Hunyuan3D worker returned when we asked it while writing this:

```
POST /infer      202 {"task_id": "...", "status": "queued"}
GET  /tasks/:id  {"status": "done", "result_gcs_url": "...", "elapsed_ms": ...}

GET  /health
{"ok": true, "model": "hunyuan3d-2.1", "gpu_available": true,
 "gpu_name": "NVIDIA RTX PRO 6000 Blackwell Server Edition",
 "pipeline_loaded": true, "ready": true, "load_error": null}
```

Two fields in that health answer carry the design. `ok` means the process is up; `ready` flips only when the model has actually loaded. A worker that opens its port before the model loads would otherwise look healthy while it is dying. The health check reads the second field, so a worker that is up but still loading is reported degraded, not healthy. Task state lives in object storage rather than in the instance, so a job submitted to one autoscaled instance and polled on another still resolves.

The Blackwell move taught us two things worth passing on. Cloud Run backs /tmp with RAM, so weights staged there and weights loaded into the process are charged to the same memory budget: 18 GiB staged plus 14 GiB loaded is a 32 GiB peak against the L4 tier's 32 GiB ceiling, and the container was killed on every cold start. The RTX PRO 6000 tier's floor of 80 GiB clears it. And Blackwell needs its GPU code built with NVIDIA's 12.8 toolkit. The worker image compiles its extensions for both GPU generations, so which card runs it is a deploy flag rather than a rebuild.

![A draft from the Hunyuan3D lane on its public model page: a noir detective in a trench coat and fedora, with the model information panel reading Engine hunyuan3d, 4 textures, 1 mesh, 30k triangles and glTF valid](/x-media/forge-article/hunyuan-detective.png)

## What it does not do yet

The last rung trades colour for completion. A job rescued by TripoSG comes back as untextured geometry, which is a shape you can keep, not the model you asked for.

Not every lane can be a rescue. Hugging Face Spaces block for the whole generation and NVIDIA's hosted lane takes text only, so neither can pick up a job that failed on a poll; both appear only in the retry suggestions. A rescue also rebuilds from the one stored reference picture, so a job that started from several photos continues from one of them, and says so.

Lane health is a probe, not a promise. Each check waits 4 seconds, and a worker that is still starting can read as unreachable to it while being perfectly able to take the job a minute later.

Small detail is where reconstruction still struggles. The detective above holds together as a figure, and his face does not survive the trip from picture to mesh.

Try it on the [Forge](https://three.ws/forge). The lane status the engine picker reads is public at [/api/forge?health=1](https://three.ws/api/forge?health=1), and the GPU field report behind the Blackwell move is [on the blog](https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell).
