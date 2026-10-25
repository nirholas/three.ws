# NVIDIA Accelerated Apps Catalog: three.ws listing kit

Everything needed to submit three.ws to the NVIDIA Inception Accelerated Apps Catalog. The form lives behind the Inception portal login (Portal > Profile > Add product), so this doc holds the copy, categories, links, and assets ready to paste. Submissions are reviewed by NVIDIA on a rolling basis; approval is subject to fit.

Related docs: [nvidia-inception.md](./nvidia-inception.md) (membership overview), [nvidia-models.md](./nvidia-models.md) (full model map, the source of truth for every NVIDIA claim below), [nvidia-visibility-map.md](./nvidia-visibility-map.md) (every other NVIDIA surface, and the asks to batch into the request email below).

---

## Status: product record saved in the portal (2026-10-25), awaiting NVIDIA review

On 2026-10-25 the owner saved the product record in Portal > Profile > Products exactly as
specified in section 1 below. The portal confirmed `three.ws 3D AI Studio saved.` and the
pasted form showed: name, `https://three.ws/forge`, Application, Shipping, GPU Accelerated,
the 447-character description, the 820-character technical details, technologies used
(cuBLAS, CUDA Python, CUDA Toolkit, cuDNN, Kaolin, Riva, Audio2Face), technologies
considered (TensorRT, Triton Inference Server, Omniverse Kit), logo
`three-ws-mark.png`, and brand color `0B0D0C`. The form did not offer NIM, nvdiffrast, L4,
or RTX PRO 6000 as selectable technologies, so those are carried by the technical details
text. The "Do not share" checkbox state was not visible in the pasted form; verify it is
unchecked. The company workloads and industries page was confirmed without changes, so the
company-profile alignment in section 2 is still open.

The only remaining step is NVIDIA's periodic review. Check the public catalog monthly. The
history below records the state before this save.

### State before the 2026-10-25 save (2026-10-17 snapshot)

The authenticated portal snapshot supplied on 2026-10-17 still shows the product row as
`three.ws | Shipping | GPU Accelerated`, but the public catalog does not list three.ws. The
record still understates the shipping NVIDIA stack:

- **Currently used:** cuBLAS, CUDA Python, CUDA Toolkit, cuDNN.
- **Considering:** DeepVariant NIM, Riva, TensorRT, Triton Inference Server, Omniverse Kit,
  Audio2Face.
- **Product URL:** the general homepage instead of the live product.
- **Product copy:** includes the payment protocol but omits the shipping Riva, NIM/NVCF,
  and Audio2Face-3D runtime.
- **Sharing control:** the form exposes `Do not share information about this product with
  NVIDIA's customers or partners.` This must be left unchecked. If it is selected, the
  record is not eligible for the directory's sharing purpose.

The portal record and the public catalog are two different systems:

- **Portal > Profile > Products** makes the company benefits-eligible and feeds NVIDIA's internal recommendation engine. The portal's own wording is "we **may** feature it in the personalized recommendations we share with our customers."
- **The public catalog** ([marketplace.nvidia.com/en-us/enterprise/applications](https://marketplace.nvidia.com/en-us/enterprise/applications/), filtered view for startups at [nvidia.com/en-gb/accelerated-applications/inception](https://www.nvidia.com/en-gb/accelerated-applications/inception/)) is curated and published by NVIDIA. Submissions are reviewed on a rolling basis and approval is subject to availability and fit. Nothing in the portal auto-publishes.

NVIDIA answered the listing request on 2026-09-14 and confirmed the operative criteria:
the product must use NVIDIA technology at runtime, its Development Stage must be
**Shipping**, the two technology fields plus Product Description and Technical Details must
carry the supporting evidence, and the record must include a product logo and brand color.
Qualifying records are reviewed periodically. NVIDIA supplied no separate form, submission
ID, or review date.

The request has therefore been made. There are now exactly two things to do: save the exact
product and company edits below, then wait for periodic review and check the public catalog
monthly.

### Current intake route

The public [NVIDIA AI Accelerated](https://www.nvidia.com/en-us/ai-data-science/ai-accelerated/)
page still displays an **Apply Now** action, but on 2026-09-14 that action resolved to
`mynvidia.force.com/NVPartners/s/nvidiaaiacceleratedprogram` and returned 404. Do not wait
on or repeatedly retry that dead link. The working route, confirmed by NVIDIA's 2026-09-14
reply, is:

1. complete the product record in the authenticated Inception portal exactly as specified
   below;
2. keep any conversation in the existing `inceptionprogram@nvidia.com` thread; and
3. wait for NVIDIA's periodic review rather than searching for another application form.

The old 2026-09-25 no-response follow-up is cancelled: NVIDIA answered on 2026-09-14.

### 1. Save this product record

| Portal field | Value |
|---|---|
| Product/Service Name | **three.ws 3D AI Studio** |
| Product/Service Webpage | **https://three.ws/forge** |
| Product/Service Type | **Application** |
| Development Stage | **Shipping** |
| Runtime acceleration | **GPU Accelerated** |
| Uses NVIDIA technologies | **Yes** |
| Product logo | `public/brand/three-ws-mark.png` (898 x 1024 RGBA PNG) |
| Brand color | **0B0D0C** |
| Do not share with NVIDIA customers or partners | **Unchecked** |

The product name adds the category words a curator and directory visitor need. The product
URL opens the shipping application directly, not the web desktop. The Forge page, NVIDIA
page, Audio2Face demo, NVIDIA model map, privacy policy, and product page all returned HTTP
200 on 2026-10-17.

### Product description, 447 characters

> three.ws turns text prompts, photos, and sketches into textured, rigged, animation-ready
> 3D avatars and models in the browser. Creators can generate, rig, pose, animate, and export
> GLB, FBX, or USDZ with no local GPU or install. Developers can embed talking 3D agents
> with one web component or use the same pipeline through APIs and MCP. Production
> generation and voice workloads are accelerated by NVIDIA GPUs, CUDA, Riva, NIM, and
> Audio2Face-3D.

### Technical details, 820 characters

> three.ws uses NVIDIA acceleration at runtime in two production layers. Self-hosted PyTorch
> microservices run on NVIDIA L4 GPUs in Google Cloud Run, with an RTX PRO 6000 Blackwell
> lane compiled for sm_120. Hunyuan3D, TRELLIS, TripoSG, TripoSR, Make-It-Animatable, and
> UniRig provide image-to-3D, text-to-3D, sketch-to-3D, and automatic humanoid rigging.
> Containers use NVIDIA CUDA Toolkit 12.1-12.8, cuDNN, cuBLAS, CUDA Python, Kaolin,
> nvdiffrast, and custom CUDA kernels. NVIDIA-hosted NIM/NVCF services provide Nemotron
> reasoning, embeddings, content safety, Riva ASR and Magpie TTS, and Audio2Face-3D facial
> animation. CPU services handle orchestration, remeshing, segmentation, and
> GLB/FBX/STL/USDZ conversion. TensorRT, Triton Inference Server, and Omniverse Kit are under
> evaluation and are not claimed as shipping.

### Correct the technology selections

As filed, the record lists only CUDA libraries as used, and parks every NVIDIA platform product under "Considering." That reads as a CUDA consumer, not a digital-human app, and it is wrong against the shipping code. Move these to **Technologies Used**:

| Technology | Evidence it is shipping |
|---|---|
| **Riva** (ASR + TTS) | [api/_lib/asr-nvidia.js](../api/_lib/asr-nvidia.js), [api/_lib/tts-nvidia.js](../api/_lib/tts-nvidia.js), Riva gRPC over NVCF |
| **Audio2Face** (A2F-3D) | [api/_lib/a2f-nvidia.js](../api/_lib/a2f-nvidia.js) against `grpc.nvcf.nvidia.com`, browser playback in [src/voice/a2f-player.js](../src/voice/a2f-player.js), live demo at [/demos/audio2face](https://three.ws/demos/audio2face) |
| **NIM microservices (hosted APIs)** | `integrate.api.nvidia.com`: Nemotron Super/Nano, Nemotron Nano VL, NV-EmbedQA-E5-v5, NemoGuard 8B |

Keep in **Technologies Used** and add if the form offers them: CUDA Toolkit, cuDNN, cuBLAS, CUDA Python, **NVIDIA Kaolin**, **nvdiffrast**, **L4 GPUs**, **RTX PRO 6000 Blackwell (sm_120)**.

Remove and leave unchecked:

- **DeepVariant NIM** is genomics variant calling. It has nothing to do with this product and it weakens category fit. Uncheck it.
- **TensorRT** and **Triton Inference Server** stay under "Considering": the GPU workers are PyTorch + CUDA today. Do not claim them.
- **Omniverse Kit** stays under "Considering" (OpenUSD interop is roadmap, not shipping).

### Portal requirement matrix

Every item NVIDIA named in its reply has one unambiguous value or source:

| NVIDIA requirement | Value / source | State |
|---|---|---|
| Runtime NVIDIA technology | Riva, Audio2Face-3D, NIM/NVCF, CUDA libraries, Kaolin/nvdiffrast, NVIDIA L4 and RTX PRO 6000 | Shipping code and live demos; portal selections corrected 2026-10-25 |
| Development Stage | **Shipping** | Saved 2026-10-25 |
| Technologies currently used | Use the corrected list above | Saved 2026-10-25 |
| Technologies being considered | TensorRT, Triton Inference Server, Omniverse Kit | Saved 2026-10-25 |
| Product Description | Paste-ready block above | Saved 2026-10-25 |
| Technical Details | Paste-ready block above | Saved 2026-10-25 |
| Product logo | `public/brand/three-ws-mark.png` (898×1024 RGBA PNG) | Saved 2026-10-25 |
| Brand color | `#0B0D0C` (the canonical dark wordmark color) | Saved 2026-10-25 |

### 2. Align the company profile

The company profile still says three.ws is applying to Inception even though it was accepted
in July 2026. It also leads with on-chain identity, names web3 as a target market, selects
Cloud Services as a target industry, and selects Trustworthy AI / Cybersecurity as a
workload. Those signals dilute the application story and conflict with the categories
[NVIDIA says are ineligible for Inception](https://www.nvidia.com/en-us/startups/).

Paste this 653-character company description:

> three.ws builds browser-native tools for embodied AI. Our platform turns prompts, photos,
> and sketches into textured, rigged 3D avatars and models, then gives them real-time voice,
> lip-sync, animation, and one-tag web embedding. Customers are creators, media and
> entertainment teams, brands, and developers building interactive agents. Unlike closed
> digital-human suites, three.ws is open source, browser-native, and supports generation,
> rigging, animation, export, APIs, and MCP in one workflow. Production workloads run on
> NVIDIA L4 and RTX PRO 6000 Blackwell GPUs with CUDA, cuDNN, and PyTorch, plus NVIDIA
> NIM/NVCF, Riva, and Audio2Face-3D services.

Use these company taxonomy selections:

- **Workloads:** Agentic AI / Generative AI; Content Creation / Rendering; Conversational
  AI; Developer Tools & Techniques; AR / VR if offered.
- **Remove workload:** Trustworthy AI / Cybersecurity. Content safety is a supporting
  feature, not the product category.
- **Primary industry:** Media & Entertainment.
- **Target industries:** Media & Entertainment; Consumer Internet if offered.
- **Remove target industry:** Cloud Services. three.ws uses cloud infrastructure but is not
  a cloud service provider.

Do not alter the legal company name, incorporation year, business status, funding, or
investor fields unless the underlying facts have changed.

### 3. Wait for catalog review

The portal has no "publish to catalog" button. The request in
[nvidia-apps-catalog-request.md](./nvidia-apps-catalog-request.md) was sent on **2026-09-04**,
and NVIDIA replied on **2026-09-14**: qualifying, complete Shipping records are reviewed
periodically. On **2026-10-25** a reply was sent in the same thread confirming the saved record
and re-asking the unanswered Showcase, ACE, and Pavilion items. There is no further catalog
email to send unless NVIDIA requests information.

---

## Core fields

**App name:** three.ws 3D AI Studio

**Company name:** three.ws LLC

**Product URL:** https://three.ws/forge

**Tagline:** Give your AI a body.

### Short description (about 130 characters)

> three.ws turns a sentence into a rigged, animated 3D AI agent. Every generation lane runs on NVIDIA GPUs and NVIDIA-hosted models.

### Medium description (about 500 characters)

> three.ws is a browser-native platform for generating 3D avatars, worlds, and AI agents from a prompt. Text, image, and sketch inputs become textured, auto-rigged GLB models in seconds, generated on a self-hosted fleet of NVIDIA L4 GPUs (Hunyuan3D, TRELLIS, TripoSG, TripoSR) and NVIDIA-hosted models via NIM. Agents get an LLM brain (Nemotron), a voice (Riva TTS and ASR), a face (Audio2Face-3D), on-chain identity, and pay-per-call x402 monetization, then embed on any website with one script tag.

### Long description (about 1,900 characters)

> three.ws is the AI-agent layer for the open web: a browser-native platform where anyone can build, embed, and monetize autonomous agents with real 3D bodies. Type a prompt at three.ws/forge and a textured 3D model appears in seconds; upload a photo or a sketch and it becomes a mesh; one more click auto-rigs it with a full skeleton and ARKit-52 blendshapes, ready to talk, walk, and be embedded anywhere with a single script tag. No plugins, no installs, no account required for the free lane.
>
> The entire generation stack runs on NVIDIA accelerated computing, in two layers. The self-hosted layer is a fleet of NVIDIA L4 GPU workers on Google Cloud Run running PyTorch with custom-compiled CUDA extensions and NVIDIA Kaolin: Hunyuan3D 2.1 and Microsoft TRELLIS for image-to-3D, TripoSG for sketch-to-3D, TripoSR for fast drafts, Make-It-Animatable for auto-rigging, and Motion Diffusion Model for text-to-animation. The Blackwell-generation RTX PRO 6000 path is validated with sm_120 kernel builds. The hosted layer is one NVIDIA API key wide: TRELLIS text-to-3D on NVCF, Nemotron LLMs for agent brains, NV-EmbedQA embeddings and Mistral reranking for agent memory, NemoGuard content safety on every public publish, Riva Magpie multilingual TTS and Riva ASR for voice, and Audio2Face-3D driving real-time facial animation in the browser.
>
> Around the bodies sits a full agent economy: on-chain identity (ERC-8004 on EVM, Metaplex Core on Solana), x402 pay-per-call so agents can charge for and pay for services autonomously, an MCP server exposing free text-to-3D to any AI assistant, and 60+ open npm SDKs. three.ws is an NVIDIA Inception member; the engineering field notes on running image-to-3D on L4 and Blackwell are published on the three.ws blog and the NVIDIA Developer Forums.

## Categories

Pick the closest available options in the form; the taxonomy varies.

- **Industry:** Media and Entertainment (alt: Gaming, Software/Internet)
- **Use case / workload:** Generative AI, 3D content creation, Digital humans / conversational AI, AI agents
- **App type:** SaaS / web application (browser-native, no install)

## NVIDIA technologies used

Every item below is live in production unless marked otherwise. Do not claim TensorRT, Triton, or self-hosted NIM microservices; the GPU workers are PyTorch + CUDA today (TensorRT-LLM is an Inception roadmap item).

Also do not claim the **video-to-scene world scanner** or the **texture worker**, and do not re-add **FlashInfer** on their behalf. Both have a GPU `cloudbuild.yaml` in the tree but neither is deployed in any region (verified 2026-08-17 and re-verified 2026-09-02 with the recount command below), so they are built code, not a running lane. The long description above used to carry the world-scanner claim in defiance of this rule; it was removed on 2026-09-02, because a submission is exactly where an unbacked claim costs the most. Deploy them and they belong here; until then a curator who checks would find nothing behind the claim.

- **NVIDIA L4 GPUs** (Google Cloud Run GPU) running the entire self-hosted 3D generation fleet: image-to-3D, sketch-to-3D, auto-rigging, text-to-motion. Eight GPU workers, twelve deployments across `us-central1` and `us-east4` (eleven L4, one RTX PRO 6000). Recount before submitting: `gcloud run services list --project aerial-vehicle-466722-p5 --format="csv[no-heading](metadata.name,region,spec.template.spec.nodeSelector)" | grep -i accelerator` Re-counted 2026-09-02: unchanged, and every public link in the [Links for the form](#links-for-the-form) section answered 200 the same day.
- **CUDA** with custom-compiled extensions (nvdiffrast, diffoctreerast, diff-gaussian-rasterization, torchmcubes)
- **NVIDIA Kaolin** (TRELLIS worker)
- **NIM APIs** (integrate.api.nvidia.com): Nemotron Super and Nano LLMs, Nemotron Nano VL vision, NV-EmbedQA-E5-v5 embeddings, Mistral 4B reranking, NemoGuard 8B content safety
- **NVCF**: microsoft/trellis text-to-3D (the free default forge lane) and FLUX.1-dev text-to-image (the hosted FLUX.1-schnell preview was retired, so do not claim schnell)
- **NVIDIA Riva**: Magpie multilingual TTS and Riva ASR over NVCF gRPC
- **NVIDIA Audio2Face-3D**: audio-driven ARKit blendshape facial animation, live at three.ws/demos/audio2face
- **RTX PRO 6000 Blackwell**: validated (sm_120 builds) for the heavy image-to-3D lane; not the default production GPU

## Links for the form

- Product: https://three.ws
- Live demo, no signup: https://three.ws/forge (text-to-3D) and https://three.ws/ar (one-tap AR)
- Audio2Face demo: https://three.ws/demos/audio2face
- Docs: https://three.ws/docs
- NVIDIA integration map: https://three.ws/docs/nvidia-models
- Engineering blog (L4 + Blackwell): https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell
- NVIDIA Developer Forums post: https://forums.developer.nvidia.com/t/how-nemotron-made-three-ws-text-to-3d-pipeline-usable/376445
- GitHub: https://github.com/nirholas/three.ws
- X: https://x.com/trythreews

## Assets to upload

All in the repo, web-ready:

- Logo mark: `public/brand/three-ws-mark.png` (also `public/three.svg` for vector)
- Lockups: `public/brand/three-ws-lockup-on-dark.png`, `public/brand/three-ws-lockup-on-light.png`
- Social/OG image: `public/og-image.png`
- Full press kit: `public/brand/three-ws-press-kit.zip`
- NVIDIA product page, 1920x1080: [`marketing/nvidia-inception/assets/three-ws-nvidia-1920x1080.png`](../marketing/nvidia-inception/assets/three-ws-nvidia-1920x1080.png)
- Audio2Face browser demo, 1920x1080: [`marketing/nvidia-inception/assets/three-ws-audio2face-1920x1080.png`](../marketing/nvidia-inception/assets/three-ws-audio2face-1920x1080.png)
- Forge product page, 1920x1080: [`marketing/nvidia-inception/assets/three-ws-forge-1920x1080.png`](../marketing/nvidia-inception/assets/three-ws-forge-1920x1080.png)

Use the NVIDIA product page first and the Audio2Face demo second. The Forge screenshot is
valid product evidence but includes `$THREE` holder controls, so it should not lead an
NVIDIA catalog submission.

## Second product record: the `<agent-3d>` digital-human embed

A genuinely distinct shipping surface with its own NVIDIA story, filed as a separate portal product AFTER the main record is corrected. It targets the Digital Humans / conversational AI workload filter, which the main (Generative AI content creation) entry does not.

**Product name:** three.ws Agent Embed (`<agent-3d>`)

**Stage:** Shipping

**Acceleration:** GPU Accelerated

**Product URL:** https://three.ws/docs/embedding

**Product logo:** `public/brand/three-ws-mark.png`

**Brand color:** `#0B0D0C`

### Short description (about 130 characters)

> One script tag puts a talking, lip-synced 3D AI agent on any website. Voice by NVIDIA Riva, facial animation by Audio2Face-3D.

### Medium description (about 500 characters)

> The `<agent-3d>` web component embeds a live, conversational 3D avatar on any site with one script tag: no plugins, no framework requirements. The avatar listens (NVIDIA Riva ASR), reasons (Nemotron via NIM APIs), speaks (Riva Magpie multilingual TTS), and moves its face in real time from NVIDIA Audio2Face-3D ARKit blendshape tracks, mapped at runtime onto whatever morph convention the visitor's avatar ships (ARKit-52, VRM vowels, Oculus visemes). Every reply is gated by NemoGuard content safety.

### Technologies Used (this record)

- Riva (ASR + Magpie TTS over NVCF gRPC)
- Audio2Face (A2F-3D blendshape streams driving browser playback)
- NIM APIs (Nemotron brains, NemoGuard safety)
- CUDA Toolkit / cuDNN (the avatar bodies it renders come from the L4 fleet)

Nothing else checked. TensorRT/Triton/Omniverse stay unchecked here too.

### Links (this record)

- Docs: https://three.ws/docs/embedding
- Live A2F demo: https://three.ws/demos/audio2face
- Voice stack source: https://github.com/nirholas/three.ws/tree/main/src/voice

### Long description (about 1,500 characters)

> `<agent-3d>` is a web component that puts a live, talking 3D AI agent on any website with one script tag. No plugin, no framework requirement, no install for the visitor: the avatar loads in a canvas, listens, answers, and lip-syncs in the browser tab.
>
> The voice loop is NVIDIA end to end. Speech in is NVIDIA Riva ASR over NVCF gRPC, which replaces the browser-only `webkitSpeechRecognition` path and works cross-browser. Reasoning is Nemotron through NIM APIs, with NemoGuard 8B content safety gating every reply before it reaches a visitor. Speech out is Riva Magpie multilingual TTS. Facial animation is NVIDIA Audio2Face-3D: the client streams 16 kHz mono PCM into the ACE `A2FControllerService` and renders the returned ARKit blendshape track against the avatar's own morph targets, remapping ARKit-52 at runtime onto whatever convention the model ships (ARKit, VRM vowels, Oculus visemes), so a creator's own upload lip-syncs without re-authoring it.
>
> The bodies it renders come from the three.ws generation fleet: NVIDIA L4 GPU workers running Hunyuan3D, TRELLIS, TripoSG, and Make-It-Animatable for auto-rigging. The embed is the delivery surface for everything that fleet produces, which is why the two product records are separate: one generates the digital human, this one ships it to an audience.

### Categories (this record)

- **Industry:** Software and Internet (alt: Media and Entertainment)
- **Use case / workload:** Digital humans, Conversational AI, AI agents
- **App type:** Web component / SDK embedded in a customer web application

Filing note: keep this record ready, but do not file it during the main listing correction.
The existing product should complete one review with one unambiguous application story first.
File the embed as a second product after the main listing is public or if NVIDIA asks for a
separate digital-human record.

---

## Submission checklist

1. Log in to the Inception portal and edit the existing `three.ws` product.
2. Change its name to **three.ws 3D AI Studio** and its URL to **https://three.ws/forge**.
3. Verify Development Stage is **Shipping** and acceleration is **GPU Accelerated**.
4. Replace Product Description and Technical Details with the character-counted blocks above.
5. Move Riva, Audio2Face, and applicable NIM services to Currently Used; retain the verified
   CUDA stack; remove DeepVariant; leave TensorRT, Triton, and Omniverse Kit under
   Considering.
6. Upload `public/brand/three-ws-mark.png` and set brand color to `0B0D0C`.
7. Ensure **Do not share with NVIDIA customers or partners** is unchecked.
8. Replace the stale company description and align its workloads and industries with the
   company-profile section above.
9. Save both records, reopen them, and capture completion evidence.
10. Do not add the second product yet and do not send the old no-response follow-up. NVIDIA
    answered on 2026-09-14.
11. Check the public catalog monthly. A live catalog URL is the only completion evidence for
   listing; a complete portal record is eligibility, not publication.
