# Microsoft channel drafts

Paste-ready posts for Microsoft-owned and Microsoft-adjacent channels: the Microsoft Tech Community, GitHub, and X posts that tag Microsoft accounts. The strategy, proof points and outreach emails are in the [Microsoft co-marketing kit](./microsoft-co-marketing.md). Written 2026-11-11.

**Nothing here has been posted.** Each post is an owner step (CLAUDE.md gate 2). Before posting:

1. Re-read the numbers from the sources in the kit's [proof points](./microsoft-co-marketing.md#proof-points) table and update them.
2. Run the phrase check below. This file must pass it with no hits.
3. Post from the owner's own accounts. Never post from a three.ws agent or an automated queue.

```bash
node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('data/x-content/partners/microsoft.json','utf8')).forbidden;const t=f.readFileSync('docs/microsoft-channel-drafts.md','utf8').toLowerCase();const hits=p.filter(x=>t.includes(x.toLowerCase()));console.log(hits.length?'FORBIDDEN: '+hits.join(', '):'clean');process.exit(hits.length?1:0)"
```

---

## The TRELLIS.2 article

The anchor piece. Publish it first on the three.ws blog and on dev.to, then point everything else at it. Every number and behaviour below comes from [`workers/model-trellis2/`](../workers/model-trellis2/README.md) and the live stats endpoints.

> # Running Microsoft's TRELLIS.2 in production: one photo to a PBR 3D asset
>
> TRELLIS.2 from Microsoft Research turns a single image into a textured 3D model. It is a 4-billion-parameter flow transformer over O-Voxel structured latents, released under the MIT license. At three.ws it is the default image-to-3D lane of the Forge, which has generated 53,860 models across all its lanes. Here is what it took to run it as production infrastructure rather than a demo.
>
> ## The shape of the service
>
> The model runs in a FastAPI worker on Cloud Run with one NVIDIA L4 (24 GB) per instance and one inference at a time per GPU, so instance count equals concurrent generations. Work is asynchronous: `POST /infer` returns `202` with a task id, and the caller polls `GET /tasks/{id}`. Finished meshes land in object storage and come back as a URL.
>
> Three resolutions are exposed: 512 for speed, 1024 by default, 1536 for maximum detail. A request the GPU cannot hold is retried one size down, and the response reports `resolution_served`, so the platform never presents a stepped-down result as the one it asked for.
>
> ## Weights that do not fit the disk
>
> The full weight set is about 15 GiB, more than Cloud Run's in-memory filesystem holds. The worker streams each sub-model from a bucket to local scratch, loads it, and deletes the file before fetching the next, so peak disk is one checkpoint. Model loading retries with backoff, and only after the last attempt fails does `/health` report 503 so the router takes the lane out of rotation.
>
> ## Alpha that renders correctly
>
> O-Voxel bakes opacity into the base colour's alpha channel but declares the material opaque. Left alone, glass and foliage render as solid. Forcing every material to blend makes solid assets halo at their edges. The worker measures how much of the texture is genuinely translucent and sets the glTF material to `BLEND` only when it is, otherwise `OPAQUE`.
>
> ## Small files without touching the textures
>
> Every GLB goes through a pinned, checksum-verified `gltfpack` with meshopt compression. Geometry is quantised; texture compression stays off, so the baked PBR maps (base colour, metallic-roughness, normal) and their alpha stay byte-exact.
>
> ## A commercially clean pipeline
>
> TRELLIS.2 itself is MIT. Its default background-removal model is licensed for non-commercial use only, so we swapped in BiRefNet (MIT) by rewriting the pipeline config at load time. The upstream files stay untouched in the weights bucket.
>
> ## Why it is the default
>
> Quality is one reason. The other is reach: TRELLIS.2 is the only default image-to-3D lane we can serve in the European Union, the United Kingdom and South Korea, where the license of our other strong image-to-3D model does not apply. An MIT-licensed model is one we can offer everywhere.
>
> ## Try it
>
> - In the browser: upload a photo at https://three.ws/forge.
> - From any MCP client: connect `https://three.ws/api/mcp-studio` (no key needed for the free tools).
> - Run the worker yourself on any 24 GB NVIDIA GPU: the Dockerfile, tests and README are in `workers/model-trellis2/` at https://github.com/nirholas/three.ws.
>
> Thanks to the TRELLIS.2 team at Microsoft Research for releasing the model under a license that lets it run in production.

---

## Tech Community post 1: TRELLIS.2 in production

**Where:** Microsoft Tech Community, in the AI or developer community space that fits best when posting. Post as a blog or discussion, matching how the [IBM Community posts](./ibm-community.md) were run.

**Title:** One photo to a PBR 3D asset: notes from running TRELLIS.2 in production

> We run Microsoft Research's TRELLIS.2 as the default image-to-3D model at three.ws, where the Forge has generated 53,860 models across its lanes. Four engineering problems came up that anyone deploying it will hit:
>
> 1. **Weights larger than the disk.** About 15 GiB of checkpoints on a serverless GPU with an in-memory filesystem. We stream each sub-model from a bucket, load it, and delete it before the next, so peak disk is one checkpoint.
> 2. **Alpha declared opaque.** O-Voxel bakes opacity into base-colour alpha but marks the material opaque. We measure real translucency and set `BLEND` only when it is there, so glass works and solid assets do not halo.
> 3. **Out-of-memory at high resolution.** A 1536 request the GPU cannot hold steps down to 1024, then 512, and the response says which resolution was served.
> 4. **License hygiene.** The default background remover is non-commercial; BiRefNet (MIT) replaces it through a config rewrite at load time.
>
> The worker is open source with its tests: `workers/model-trellis2/` in https://github.com/nirholas/three.ws. The full write-up: [link to the TRELLIS.2 article once published].
>
> Questions welcome, especially from anyone serving TRELLIS.2 on smaller GPUs.

---

## Tech Community post 2: 3D tools in Copilot Studio

**Post only after** the MCP certification has been submitted (owner checklist step 15 in the [offer plan](./microsoft-marketplace-offer-plan.md#owner-checklist-in-order)), and walk through the steps in Copilot Studio first so the click path matches the current UI. Until certification is granted, describe the server as one a maker connects themselves.

**Title:** Generating 3D models from a Copilot Studio agent with a remote MCP server

> Most MCP demos return text. This one returns 3D models.
>
> three.ws runs a remote MCP server at `https://three.ws/api/mcp-studio` with 16 tools: text to 3D, photo to 3D, auto-rigging, an avatar from a prompt, a search over thousands of CC0 props, characters and motion clips, and model inspection. The generation and catalog tools need no key.
>
> To try it, add it to a Copilot Studio agent as a Model Context Protocol tool, pointing at that URL. Then ask the agent for "a brass desk lamp with a green glass shade". You get back a viewer link, a downloadable GLB, a rendered PNG and paste-ready embed HTML.
>
> A detail for anyone building MCP servers with slow tools: a generation takes one to four minutes, and many clients drop a request at 60 seconds. Our server answers a plain request within 40 seconds with either the model or a `pending` job id, and the agent collects the model with `get_job`. Clients that stream progress notifications can wait for the whole render. If your tools run long, design for both.
>
> Docs: https://three.ws/docs/mcp-studio

---

## GitHub Show and tell on microsoft/TRELLIS.2

**Where:** the Show and tell category of Discussions on `github.com/microsoft/TRELLIS.2`, if Discussions is enabled. If it is not, do not open an issue: issues are for bugs, and a promotional issue costs goodwill with the very team we want to notice us.

**Title:** TRELLIS.2 in production on Cloud Run (open-source worker)

> Thank you for releasing TRELLIS.2 under MIT. We run it as the default image-to-3D lane at three.ws and have open-sourced the worker: https://github.com/nirholas/three.ws/tree/main/workers/model-trellis2
>
> Things in it that may help other deployers:
>
> - streaming weight load, so the roughly 15 GiB set runs on an instance whose disk cannot hold it all at once;
> - alpha-mode detection, since O-Voxel output bakes opacity into base-colour alpha while declaring the material opaque;
> - resolution step-down on OOM (1536 to 1024 to 512), with the served resolution reported;
> - BiRefNet (MIT) in place of the default background remover, via a config rewrite at load time;
> - meshopt packing that leaves the baked PBR textures byte-exact.
>
> Happy to upstream any of this if it is useful.

---

## X posts

Post from @trythreews. The tags are the accounts that own the subject of each post, not accounts asked to endorse anything.

**1. TRELLIS.2 thread (post after the article is live)**

> 1/ The default image-to-3D model at three.ws is TRELLIS.2 from @MSFTResearch. One photo in, a PBR-textured 3D model out, MIT licensed. Here is what running it in production taught us.
>
> 2/ The weights are about 15 GiB, more than a serverless GPU's disk holds. We stream each sub-model in, load it, delete it, then fetch the next. Peak disk: one checkpoint.
>
> 3/ The output bakes opacity into the texture but marks the material opaque. We measure real translucency, so glass renders as glass and solid models do not halo.
>
> 4/ The license is why it is our default. MIT means we can serve it everywhere, including the EU, the UK and South Korea.
>
> 5/ The worker is open source. Full write-up: [article link]. Try it: three.ws/forge

**2. MCP tools that return 3D (post after Tech Community post 2)**

> Most MCP servers return text. Ours returns 3D models.
>
> 16 tools at three.ws/api/mcp-studio: text to 3D, photo to 3D, auto-rig, avatars, a CC0 asset search. Connect it to any MCP client, including a Copilot Studio agent. No key for the free tools.

**3. VS Code extension (post any time)**

> The three.ws x402 extension for @code is on the Visual Studio Marketplace: pay-per-call APIs from inside your editor.
>
> marketplace.visualstudio.com/items?itemName=threews.vscode-x402

**4. Marketplace listing (only once the SaaS offer is live and purchasable)**

> three.ws is live on Microsoft Marketplace. Teams can now buy three.ws plans on their existing Microsoft invoice and sign in with their work account.
>
> [offer link]

Hold post 4 until a preview purchase has gone through end to end. Until then the listing is a publisher profile, and the approved wording is only "three.ws is live on Microsoft Marketplace".

---

## Related

- [Microsoft co-marketing kit](./microsoft-co-marketing.md)
- [three.ws and Microsoft](./microsoft.md)
- [model-trellis2 worker](../workers/model-trellis2/README.md)
- [MCP studio](./mcp-studio.md)
