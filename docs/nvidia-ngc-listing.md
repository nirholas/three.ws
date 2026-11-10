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
| Containerized using the CUDA 9 or later base container | **Met** | Two-stage build in [workers/model-trellis/Dockerfile](../workers/model-trellis/Dockerfile): `nvidia/cuda:12.6.3-devel-ubuntu24.04` compiles the CUDA extensions and the shipped image is `nvidia/cuda:12.6.3-runtime-ubuntu24.04`. Eight GPU workers in the tree are built on `nvidia/cuda` 12.1 to 12.8. |
| GPU accelerated, automatically multi-GPU capable, runs on Pascal or newer | **Partly met** | GPU acceleration is implemented with TRELLIS, nvdiffrast, diffoctreerast, diff-gaussian-rasterization, and NVIDIA Kaolin. The NGC image is compiled for `8.0;8.6;8.9;9.0+PTX` and ran real inference on an A100 and an L4, but the server remains single-GPU by design. See [gate 2](#gate-2-the-kernels-are-compiled-for-one-gpu-generation) and [gate 3](#gate-3-multi-gpu-requirement-needs-nvidia-guidance). |
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

**Status: validated on Ampere and Ada (2026-11-10).**

The production Dockerfile sets `TORCH_CUDA_ARCH_LIST="8.9"`, deliberately, to
keep our own builds fast on the L4 fleet. An image compiled for `sm_89` alone
does not run on the Ampere, Hopper, or Blackwell hardware an NGC user is most
likely to have, and NVIDIA's prerequisite reads "Pascal or newer". The list is
a build argument, so the NGC build passes a portable matrix without changing
the production image.

**Pinned NGC matrix: `8.0;8.6;8.9;9.0+PTX`.** Image
`us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server@sha256:f6634a81fa68a85de82179a96d67f8585ad09402ee0e2f3b3dc421a7acd3c5d2`
(Cloud Build `0d26c01f`, two-stage, CUDA 12.6, Python 3.12, torch 2.6):

| GPU | Result |
|---|---|
| A100-SXM4-40GB (Ampere, `sm_80`) | `POST /infer` reached `done` in 63.5 s; the downloaded GLB loads with one textured mesh, 55,943 triangles |
| L4 (Ada, `sm_89`) | `done` in 118.4 s; the GLB loads with one textured mesh, 57,289 triangles |
| H100 (Hopper, `sm_90`) | Not run. The project's H100 quota is 0 and the increase request was denied on 2026-11-10. The image carries native `sm_90` code plus PTX for newer GPUs. |

Both runs used the standalone mode an NGC user gets: mounted weights, local
`OUTPUT_DIR`, no cloud credentials, authenticated `GET /results/{task_id}.glb`
download. The same image passed its in-image test gate (65 pytest cases and the
29-assertion served contract) and a Trivy scan with 0 CRITICAL and 2 upstream-only
HIGH findings, down from 70 CRITICAL and 1437 HIGH in the single-stage image. It
is 8.39 GB compressed in 22 layers, against 12.30 GB in 31. Every number, digest
and GLB checksum is in
[NGC-VALIDATION.md](../workers/model-trellis/NGC-VALIDATION.md).

The build-only Cloud Build configuration is
[cloudbuild.ngc.yaml](../workers/model-trellis/cloudbuild.ngc.yaml). It builds
and pushes the `ngc-candidate` tag without deploying or changing the production
Cloud Run service, and [scripts/ngc-validate-trellis.sh](../scripts/ngc-validate-trellis.sh)
reruns the GPU check on a short-lived spot VM that it deletes afterwards.

```bash
gcloud builds submit workers/model-trellis \
  --project aerial-vehicle-466722-p5 \
  --config workers/model-trellis/cloudbuild.ngc.yaml
```

### Gate 3: multi-GPU requirement needs NVIDIA guidance

**Status: open, waiting on NVIDIA's answer. Nothing speculative is built.**

The current server serializes inference on one GPU because a TRELLIS job fills
most of an L4. Horizontal replicas provide production concurrency, but the NGC
FAQ specifically says "automatically multi-GPU capable." Process-per-GPU model
replication inside one container is built and validated only if NVIDIA says
service-per-GPU orchestration is not acceptable for this workload.

Ready to send to the NVIDIA partner contact as soon as the intake form is
acknowledged:

> Hello, we are submitting three.ws TRELLIS Mesh Server (image to textured GLB,
> Microsoft TRELLIS, MIT) for the NGC Catalog. The container runs one model
> replica on one GPU and serializes jobs on it, because a single TRELLIS job
> uses most of a 24 GB GPU. On a multi-GPU host we scale by running one
> container per GPU (`--gpus device=N`), which is how our production fleet
> scales. Does the "automatically multi-GPU capable" prerequisite accept this
> service-per-GPU model, or should the staging image detect every visible GPU
> and run one model process per GPU inside a single container? We will build
> whichever you require before pushing to staging.

### Gate 4: the NGC partner legal agreement and the staging push

Owner action. It is step 1 of NVIDIA's published process and nothing technical
depends on it. The staging push is prepared as one command that refuses to run
without an explicit flag.

1. Submit the **Become an NGC Software Partner** form (answers below) and sign
   the NGC Partner Legal Agreement when NVIDIA sends it.
2. In the NGC web console, note the organization name NVIDIA assigns and create
   the private staging repository `nvcr.io/<org>/trellis-mesh-server`.
3. Generate an NGC API key (NGC console, Setup, API Key) and export it in the
   shell only: `export NGC_API_KEY=...`. Never pass it on the command line.
4. Push the validated digest recorded in
   [NGC-VALIDATION.md](../workers/model-trellis/NGC-VALIDATION.md):

```bash
scripts/ngc-stage-trellis.sh --org <org> --version 1.0.0 \
  --digest sha256:<validated digest> --yes-push
```

Without `--yes-push` the script prints the plan, contacts neither Artifact
Registry nor NGC, and exits 2.

## The publishing process, as NVIDIA documents it

1. Sign the NGC Partner Legal Agreement.
2. Push the container to an NGC private staging repository.
3. Pass container security scanning and quality-assurance testing.
4. Complete final sign-off, after which the image goes live in the catalog.

Step 3 is prepared for. The image is a two-stage build: the CUDA extensions
compile in a `devel` builder and only the built virtualenv ships on a `runtime`
base, so no compiler or toolkit headers reach the scanner. Our own Trivy scan of
the staged digest shows 0 CRITICAL and 2 HIGH, both upstream-only (torch 2.6,
whose fix needs a torch release the TRELLIS CUDA dependencies do not support yet,
and the setuptools copy pip vendors). Details in
[NGC-VALIDATION.md](../workers/model-trellis/NGC-VALIDATION.md#vulnerability-scan).

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

**Labels:** framework PyTorch, task Image to 3D, precision FP16, architecture Ampere, Ada, Hopper (`sm_80`, `sm_86`, `sm_89`, `sm_90` plus PTX)

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

> The NGC image is compiled for Ampere, Ada, and Hopper (sm_80, sm_86, sm_89,
> sm_90, plus PTX for newer GPUs). Inference is validated end to end on NVIDIA
> A100 and NVIDIA L4; L4 is also our production target. Hopper (H100) is
> covered by native sm_90 code and has not yet been run. RTX PRO 6000 Blackwell
> has been validated for the heavy image-to-3D lane of our hosted service.

**Question for the NVIDIA contact after submission:**

> This inference service schedules one model replica per GPU and scales through
> service replicas because one TRELLIS job uses most of an L4. Does NGC's
> automatically multi-GPU-capable prerequisite accept service-per-GPU
> orchestration, or should the staging image implement process-per-GPU model
> replication inside one container?

**Quick start (goes in the listing body)**

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
3. Confirm the multi-GPU interpretation with NVIDIA (gate 3), then stage the
   validated digest with `scripts/ngc-stage-trellis.sh --yes-push` (gate 4).

## Verification log

| Claim | Checked how | Result |
|---|---|---|
| NGC prerequisites and the four-step process | `WebFetch` on the NGC Software Partners page, 2026-09-02 | Quoted verbatim in the audit table above |
| A self-serve intake form exists | Same fetch | "Become an NGC Software Partner" form on that page; no email address published |
| Base images are CUDA 12.x | `grep FROM workers/*/Dockerfile` | Eight GPU workers on `nvidia/cuda` 12.1 to 12.8 |
| The container collects nothing | `grep -rniE "posthog|analytics|telemetry|mixpanel|sentry" workers/model-trellis` | No matches |
| Weights are not baked into the image | [workers/model-trellis/README.md](../workers/model-trellis/README.md) and the Dockerfile | Weights mount at `/weights`; no `COPY` of any checkpoint |
| Standalone storage | [main.py](../workers/model-trellis/main.py), [storage_backend.py](../workers/model-trellis/storage_backend.py) | Local mounted-volume mode implemented; GCS remains the production path |
| CUDA architecture configuration | [Dockerfile](../workers/model-trellis/Dockerfile) | Production defaults to `8.9`; the NGC build pins `8.0;8.6;8.9;9.0+PTX` |
| Two-stage image is smaller and scan-clean of CRITICAL | Cloud Build `0d26c01f`, Trivy scan build `1d5a5e6c`, 2026-11-10 | 22 layers and 8.39 GB (was 31 and 12.30 GB); 0 CRITICAL, 2 upstream-only HIGH (was 70 and 1437) |
| Real inference on Ampere and Ada | `scripts/ngc-validate-trellis.sh` on GCE A100 and L4 VMs, 2026-11-10 | Both tasks `done`, both GLBs load with a textured mesh; VMs deleted. H100 quota denied |
| Upstream licenses | Worker READMEs | TRELLIS MIT, MDM MIT, Hunyuan3D non-commercial |

## Related

- [NVIDIA visibility map](./nvidia-visibility-map.md): every other NVIDIA surface and its intake route
- [Accelerated Apps Catalog listing kit](./nvidia-apps-catalog-listing.md) and [inclusion request](./nvidia-apps-catalog-request.md)
- [NVIDIA Inception membership](./nvidia-inception.md): what membership is, and the rule that it is not an endorsement
- [NVIDIA models on three.ws](./nvidia-models.md): the source of truth for every NVIDIA technical claim
- [Listings and distribution](./listings.md): the canonical program and directory inventory

Validation record and owner steps: [workers/model-trellis/NGC-VALIDATION.md](../workers/model-trellis/NGC-VALIDATION.md).
