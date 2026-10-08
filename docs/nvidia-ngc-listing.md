# NGC Catalog listing: the one NVIDIA directory with a self-serve door

[nvidia-visibility-map.md](./nvidia-visibility-map.md) records that no self-serve
"list my product" form exists on any NVIDIA surface. That is true of every
surface except one. The [NGC Software Partner program](https://www.nvidia.com/en-us/gpu-cloud/ngc-software-partners/)
publishes a **Become an NGC Software Partner** form, and a container published
through it lands in [catalog.ngc.nvidia.com](https://catalog.ngc.nvidia.com/)
permanently, hosted by NVIDIA, on NVIDIA's domain, in front of NVIDIA's
enterprise audience.

The Accelerated Apps Catalog is a marketing listing of the company. An NGC
listing is a distribution channel for the software itself. They are worth
pursuing in parallel and this doc covers only the second; the first has its own
kit in [nvidia-apps-catalog-listing.md](./nvidia-apps-catalog-listing.md).

Prerequisites and process below were re-fetched from NVIDIA's page on
2026-09-02. Every claim about our own containers is cited to the file that
proves it.

---

## Verdict

**Publishable candidate: [workers/model-trellis](../workers/model-trellis).**
Single image in, textured GLB out, on one L4. It is the strongest of the GPU
fleet for an outside user because its model is MIT-licensed, its weights are not
baked into the image, and it collects nothing.

**The two portability blockers are now implemented.** The container keeps its
production GCS backend when `GCS_BUCKET` is set and switches to a mounted local
output volume when it is not. The CUDA architecture list is also a build
argument, so the NGC build can target a broader GPU matrix without changing the
production L4 image.

One published prerequisite still needs resolution: NVIDIA asks for an
automatically multi-GPU-capable application, while this inference server
deliberately runs one job on one GPU. The NGC intake should ask whether
service-per-GPU orchestration satisfies that requirement or whether NVIDIA
expects in-container model replication. Do not claim this prerequisite as met
until NVIDIA answers or a multi-GPU implementation is validated.

## Prerequisite audit

NVIDIA's four published prerequisites, each against the code:

| NVIDIA prerequisite | Status | Evidence |
|---|---|---|
| Containerized using the CUDA 9 or later base container | **Met** | `FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04` in [workers/model-trellis/Dockerfile](../workers/model-trellis/Dockerfile). Eight GPU workers in the tree are built on `nvidia/cuda` 12.1 to 12.8. |
| GPU accelerated, automatically multi-GPU capable, runs on Pascal or newer | **Partly met** | GPU acceleration is implemented with TRELLIS, nvdiffrast, diffoctreerast, diff-gaussian-rasterization, and NVIDIA Kaolin. The architecture list is now configurable, but the server remains single-GPU by design. See [gate 2](#gate-2-the-kernels-are-compiled-for-one-gpu-generation) and [gate 3](#gate-3-multi-gpu-requirement-needs-nvidia-guidance). |
| An end-user license agreement for the application | **Met by this change** | [NVIDIA NGC Container EULA](https://three.ws/legal/nvidia-ngc-eula), source at [public/legal/nvidia-ngc-eula.html](../public/legal/nvidia-ngc-eula.html). It covers the Apache-2.0 code, the third-party components, and the fact that the image ships no weights. |
| Container does not collect personal data or violate GDPR | **Met** | The worker has no analytics, telemetry, or reporting of any kind: a search of [workers/model-trellis](../workers/model-trellis) for `posthog`, `analytics`, `telemetry`, `mixpanel`, and `sentry` returns nothing. The only outbound calls it makes are the ones the caller asks for, and those go through the SSRF guard in [worker_security.py](../workers/model-trellis/worker_security.py). |

## Why this container and not the others

| Worker | Model license | Verdict for NGC |
|---|---|---|
| [model-trellis](../workers/model-trellis) | Microsoft TRELLIS, MIT | **Candidate.** Commercial-safe upstream, weights fetched by the user. |
| [model-text2motion](../workers/model-text2motion) | MDM, MIT | **Second candidate.** Commercial-safe code and model, but the deployed HumanML3D checkpoint inherits research-only dataset terms, so the listing would have to point users at the upstream checkpoint and say so plainly. |
| [model-hunyuan3d](../workers/model-hunyuan3d) | Tencent Hunyuan **non-commercial** | **Not publishable.** The license is documented in [its README](../workers/model-hunyuan3d/README.md). Publishing a serving image for it into an enterprise catalog invites exactly the use the license forbids. |
| [model-triposg](../workers/model-triposg), [model-triposr](../workers/model-triposr), [model-video2scene](../workers/model-video2scene), [avatar-reconstruction](../workers/avatar-reconstruction), [longcat](../workers/longcat) | Mixed | Not first. Each carries its own upstream terms to clear, and one clean listing beats five contested ones. |

None of these images bake weights, which is what makes any of this possible: the
container is our serving code plus a CUDA build, and the user brings the model.

## The gates

### Gate 1: the container must run outside our cloud project

**Status: implemented.**

[main.py](../workers/model-trellis/main.py) now treats `GCS_BUCKET` as optional.
When it is set, production behavior remains GCS-backed. When it is unset, the
worker uses `OUTPUT_DIR` (default `/output`) for atomic task records and GLBs,
returns `result_url` plus `result_path`, and serves authenticated downloads from
`GET /results/{task_id}.glb`. `GET /health` reports the active backend.

Path and persistence behavior is isolated in
[storage_backend.py](../workers/model-trellis/storage_backend.py) and covered by
[test_storage_backend.py](../workers/model-trellis/test_storage_backend.py).

The worker's tests run inside the built image (`docker run --rm model-trellis
python3 test_app_contract.py`), so this change is verified by a GPU build, not
from a laptop. Budget one Cloud Build run for it.

### Gate 2: the kernels are compiled for one GPU generation

**Status: configurable, validation pending.**

The Dockerfile sets `TORCH_CUDA_ARCH_LIST="8.9"`, deliberately, to keep our own
builds fast on the L4 fleet. An image compiled for `sm_89` alone does not run on
the Ampere, Hopper, or Blackwell hardware an NGC user is most likely to have,
and NVIDIA's prerequisite reads "Pascal or newer".

The Dockerfile now exposes `TORCH_CUDA_ARCH_LIST` as a build argument and keeps
`8.9` as the production default. The first NGC candidate build should use
`8.0;8.6;8.9;9.0+PTX`, then run on at least one Ampere or Hopper GPU plus the
existing L4 validation. Pin the final matrix only after those compiled
extensions pass the real build and inference checks.

The build-only Cloud Build configuration is
[cloudbuild.ngc.yaml](../workers/model-trellis/cloudbuild.ngc.yaml). It builds
and pushes the `ngc-candidate` tag without deploying or changing the production
Cloud Run service.

**Current candidate (rebuilt 2026-10-08).** The first candidate (2026-09-14) predated
the system-library fix in commit `35d798585`, the one behind the 2026-09-19 to 09-25
TRELLIS outage, so it was rebuilt from commit `85372d38d` as Cloud Build
`e336574a-7141-46bf-9514-b15c492d79c8`: `TORCH_CUDA_ARCH_LIST=8.0;8.6;8.9;9.0+PTX`,
image `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server:ngc-candidate`,
digest `sha256:8c9d543dbc563bfd1bf80133ae9865e407bad9666d8724259872419d0fa45629`.
The build-time gate passed inside that exact image: 25 request-policy and
storage-backend tests, and the full served-contract test including the TRELLIS
import chain, auth boundary, and dead-pipeline 503 behaviour. What is still not
done is the GPU half of gate 2: an inference run on an Ampere or Hopper GPU, which
Cloud Run does not offer, so it needs a short-lived GCE A100 or H100 VM.

```bash
gcloud builds submit workers/model-trellis \
  --project aerial-vehicle-466722-p5 \
  --config workers/model-trellis/cloudbuild.ngc.yaml
```

### Gate 3: multi-GPU requirement needs NVIDIA guidance

**Status: open.**

The current server serializes inference on one GPU because a TRELLIS job fills
most of an L4. Horizontal replicas provide production concurrency, but the NGC
FAQ specifically says "automatically multi-GPU capable." Ask NVIDIA whether
one service replica per GPU is acceptable for this inference workload. If it
is not, build and validate process-per-GPU model replication before pushing the
staging image.

### Gate 4: the NGC partner legal agreement

Owner action. It is step 1 of NVIDIA's published process and nothing technical
depends on it, so it can be signed while gates 1 and 2 are being built.

## The publishing process, as NVIDIA documents it

1. Sign the NGC Partner Legal Agreement.
2. Push the container to an NGC private staging repository.
3. Pass container security scanning and quality-assurance testing.
4. Complete final sign-off, after which the image goes live in the catalog.

Step 3 is the one to prepare for. A `devel` CUDA base ships a compiler and a
large package surface, so expect the scan to flag CVEs in build tooling we do
not need at run time. If it does, the answer is a two-stage build that compiles
the CUDA extensions in the `devel` image and copies them into a `runtime` base,
which also cuts the published image size.

## Listing content, paste-ready

**Publisher:** three.ws

**Container name:** `three-ws/trellis-mesh-server`

**Display name:** three.ws TRELLIS Mesh Server

**Short description (about 120 characters)**

> A GPU inference server that turns a single image into a textured, ready-to-use 3D mesh with Microsoft TRELLIS.

**Overview**

> This container serves single-image 3D reconstruction over HTTP. Post one image (or up to six turnaround views of the same subject) and it returns a textured GLB, generated with Microsoft TRELLIS on one NVIDIA GPU, through the same serving code that runs the free text-to-3D and image-to-3D lanes on three.ws.
>
> It is the production server, not a demo wrapper: asynchronous job handling with a task API, four quality tiers from draft to max, optional background matting before reconstruction, an SSRF guard on every caller-supplied image URL, and a health endpoint that reports whether the pipeline finished loading so an orchestrator can route around a cold instance.
>
> Model weights are not included. Download `TRELLIS-image-large` from Microsoft's Hugging Face repository and mount it at `/weights/trellis-large`. TRELLIS is MIT licensed; this container is licensed under the three.ws NVIDIA NGC Container EULA and its source is Apache-2.0 at github.com/nirholas/three.ws.

**Tags:** 3D, generative AI, mesh generation, inference server, digital humans, TRELLIS, computer vision

**Labels:** framework PyTorch, task Image to 3D, precision FP16, architecture Ada and newer (final list set by the build in gate 2)

**Links**

- Publisher: https://three.ws
- Live product using this container: https://three.ws/forge
- Source: https://github.com/nirholas/three.ws/tree/main/workers/model-trellis
- EULA: https://three.ws/legal/nvidia-ngc-eula
- Upstream model: https://github.com/microsoft/TRELLIS

## NGC partner intake form, paste-ready

The live NVIDIA form asks for these product fields. Identity, job-title, and
location selections must match the account holder's legal information.

**Organization / University Name:** three.ws

**Industry:** Media and Entertainment

**Product Name:** three.ws TRELLIS Mesh Server

**Link to Product Home Page:** https://three.ws/forge

**What does your product do?**

> three.ws TRELLIS Mesh Server is a containerized GPU inference service that
> turns one image, or multiple views of the same subject, into a textured GLB
> 3D asset. It uses Microsoft TRELLIS with NVIDIA CUDA, Kaolin, nvdiffrast, and
> custom CUDA extensions. The container supports authenticated asynchronous
> jobs, configurable quality tiers, SSRF-protected image intake, health checks,
> and local mounted-volume output without requiring a cloud account. Model
> weights are mounted separately and are not included in the image.

**List NVIDIA GPUs supported by your Product:**

> NVIDIA L4 is the verified production target. RTX PRO 6000 Blackwell has been
> validated for the heavy image-to-3D lane. The portable NGC architecture
> matrix for Ampere, Ada, and Hopper will be finalized during NVIDIA staging
> and validation.

**Question for the NVIDIA contact after submission:**

> This inference service schedules one model replica per GPU and scales through
> service replicas because one TRELLIS job uses most of an L4. Does NGC's
> automatically multi-GPU-capable prerequisite accept service-per-GPU
> orchestration, or should the staging image implement process-per-GPU model
> replication inside one container?

**Quick start (goes in the listing body, once gate 1 lands)**

```bash
docker run --gpus all -p 8080:8080 \
  -e API_KEY=choose-a-secret \
  -v /path/to/trellis-image-large:/weights/trellis-large:ro \
  -v /path/to/output:/output \
  nvcr.io/three-ws/trellis-mesh-server:latest

curl -X POST http://localhost:8080/infer \
  -H "Authorization: Bearer choose-a-secret" \
  -H 'Content-Type: application/json' \
  -d '{"images":["https://three.ws/avatars/thumbs/default.png"],"tier":"standard"}'
```

Poll the returned task, then download its local result with the same bearer:

```bash
curl -H "Authorization: Bearer choose-a-secret" \
  http://localhost:8080/tasks/TASK_ID

curl -L -H "Authorization: Bearer choose-a-secret" \
  -o result.glb http://localhost:8080/results/TASK_ID.glb
```

## What is owner-gated

Everything that leaves the machine. Submitting the partner form, signing the
legal agreement, and pushing to the staging repository are all outward-facing
and none of them are an agent's call:

1. Submit **Become an NGC Software Partner** at [nvidia.com/en-us/gpu-cloud/ngc-software-partners](https://www.nvidia.com/en-us/gpu-cloud/ngc-software-partners/). Mention the Inception membership in the form; it is the same company record.
2. Sign the NGC Partner Legal Agreement when it comes back.
3. Confirm the multi-GPU interpretation with NVIDIA, then run the portable image
   build and GPU validation.

## Verification log

| Claim | Checked how | Result |
|---|---|---|
| NGC prerequisites and the four-step process | `WebFetch` on the NGC Software Partners page, 2026-09-02 | Quoted verbatim in the audit table above |
| A self-serve intake form exists | Same fetch | "Become an NGC Software Partner" form on that page; no email address published |
| Base images are CUDA 12.x | `grep FROM workers/*/Dockerfile` | Eight GPU workers on `nvidia/cuda` 12.1 to 12.8 |
| The container collects nothing | `grep -rniE "posthog|analytics|telemetry|mixpanel|sentry" workers/model-trellis` | No matches |
| Weights are not baked into the image | [workers/model-trellis/README.md](../workers/model-trellis/README.md) and the Dockerfile | Weights mount at `/weights`; no `COPY` of any checkpoint |
| Standalone storage | [main.py](../workers/model-trellis/main.py), [storage_backend.py](../workers/model-trellis/storage_backend.py) | Local mounted-volume mode implemented; GCS remains the production path |
| CUDA architecture configuration | [Dockerfile](../workers/model-trellis/Dockerfile) | Production defaults to `8.9`; catalog builds can pass a wider list |
| Upstream licenses | Worker READMEs | TRELLIS MIT, MDM MIT, Hunyuan3D non-commercial |

## Related

- [NVIDIA visibility map](./nvidia-visibility-map.md): every other NVIDIA surface and its intake route
- [Accelerated Apps Catalog listing kit](./nvidia-apps-catalog-listing.md) and [inclusion request](./nvidia-apps-catalog-request.md)
- [NVIDIA Inception membership](./nvidia-inception.md): what membership is, and the rule that it is not an endorsement
- [NVIDIA models on three.ws](./nvidia-models.md): the source of truth for every NVIDIA technical claim
- [Listings and distribution](./listings.md): the canonical program and directory inventory
