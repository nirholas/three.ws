# Task: HD photo-to-avatar backend (NextFace)

## Context

Repo: `/workspaces/3D`. Task 07 ships a fast, in-browser avatar. This task adds the **high-fidelity path**: a GPU backend running [abdallahdib/NextFace](https://github.com/abdallahdib/NextFace) (MIT) that accepts three photos and returns a photoreal head mesh + textures, which we re-topologize onto our VRM template.

This is the "Avaturn quality" tier. It runs async in the background: task 07's result shows immediately; task 08's result replaces it a minute later when ready.

Depends on task 07 (to have a result to replace).

## Goal

1. A containerized NextFace service with a REST endpoint: `POST /api/reconstruct` accepting three images, returning a mesh + albedo + normal map archive.
2. A client-side module that posts to that endpoint and, on completion, patches the VRM from task 07 with the higher-fidelity head geometry and textures.
3. Sensible fallback: if the service is down or slow, the fast-path avatar simply remains in place.

## Deliverable

1. **Backend service** under `services/nextface/`:
   - `Dockerfile` starting from a PyTorch CUDA base image.
   - `requirements.txt` with NextFace's pins (pull from upstream).
   - `server.py` — a minimal FastAPI or Flask app exposing:
     - `POST /api/reconstruct` — multipart with `center`, `left`, `right` image fields → returns a `application/zip` of `{ mesh.obj, albedo.png, normal.png, meta.json }`.
     - `GET /health` — GPU status, queue depth, model warm/cold.
   - Concurrency: one job at a time per GPU; additional requests queue.
   - Timeouts: 120s hard cap, 60s soft target.
2. **Deployment docs** in `services/nextface/DEPLOY.md`:
   - Supported hardware (minimum: 8 GB VRAM, CUDA 11.8+).
   - One-liner to run locally: `docker build && docker run --gpus all -p 8080:8080 ...`.
   - One production target choice: Modal, Replicate, RunPod, Baseten, or self-hosted. **Pick one and document it**. Don't spread across all.
3. **Client module** `src/capture/hd-avatar.js`:
   - `async requestHD(blobs, baseVRMBlob, { endpoint, timeoutMs = 90000 })` → Promise<`Blob` (upgraded VRM)> or rejects.
   - Posts multipart, streams progress events if the backend supports them (optional, nice-to-have).
   - Applies the returned mesh + textures onto the VRM from task 07:
     - Replaces head mesh geometry (keeping bone weights re-projected via closest-point mapping).
     - Replaces face texture.
     - Normal map applied to the head material if the VRM supports it.
4. **Orchestration** `src/capture/avatar-pipeline.js`:
   - Combines 07 + 08. `async runPipeline(blobs, { onFast, onHD, onError })`:
     - Resolves `onFast` with the fast-path VRM.
     - In parallel, kicks off `requestHD`; on resolve, calls `onHD` with the upgraded VRM.
     - On HD failure, calls `onError({ stage: 'hd' })` but does not discard the fast-path result.
5. **Config** — `VITE_HD_ENDPOINT` env var for the client; `NEXTFACE_MODEL_DIR` for the backend.

## Audit checklist

- [ ] NextFace license is MIT (confirm upstream before starting).
- [ ] End-to-end latency (three 1MP photos → HD VRM) is < 90s p95 on the chosen production target.
- [ ] If the backend is unreachable, the pipeline emits `onError({ stage: 'hd' })` without discarding the fast-path avatar.
- [ ] The re-topologized mesh keeps the VRM humanoid rig intact — expressions still work after the HD patch.
- [ ] Skin tone on the HD result matches the photos more closely than task 07's result (visual check on 3 test faces).
- [ ] No photos persist on the backend beyond the request lifecycle (confirm via filesystem audit in the Dockerfile's tmpfs usage).
- [ ] Backend has auth: a bearer token or signed session token (reuse task 05's session IDs if that's easiest).
- [ ] Client respects a global "opt out of HD" setting (env or runtime flag) for privacy-sensitive deploys.

## Constraints

- Do not ship the NextFace model weights in the main frontend bundle.
- Do not commit GPU-specific binaries to git. Weights download on container start or at build time.
- Pay cost matters: design so idle cost is ~$0 (scale-to-zero).
- Do not proxy images through the main app server; the client posts directly to the HD endpoint (with a pre-signed token from task 05 if needed).
- Do not train, fine-tune, or upload photos to a third-party ML service.

## Verification

1. Build and run the Docker image locally on a machine with a GPU (or a cloud dev env). Hit `/health` → 200.
2. `curl -F center=@c.jpg -F left=@l.jpg -F right=@r.jpg http://localhost:8080/api/reconstruct` → returns a zip.
3. Run the full pipeline via `avatar-pipeline.js` in the browser → `onFast` fires in < 5s, `onHD` fires in < 90s with a noticeably better avatar.
4. Kill the backend mid-flight → `onError` fires, fast-path result remains displayed.
5. Budget check: confirm your chosen platform can handle 100 concurrent jobs at the queued-throughput target, and estimate the cost per avatar.

## Scope boundaries — do NOT do these

- No additional face-reconstruction models beyond NextFace. We can swap later if quality is wrong, but one model per task.
- No hair/body reconstruction — face only. Body comes from the template + editor.
- No video input — stills only.
- Do not store reconstructed avatars on the backend; return once, discard.

## Reporting

- Chosen deployment target + a one-sentence rationale.
- Upstream NextFace commit SHA used.
- Latency numbers (mean, p95, max) on the chosen hardware.
- Per-avatar GPU cost estimate.
- Qualitative quality delta vs task 07 on the same 5 test faces.
- Known failure modes of NextFace itself (e.g., occluded faces, extreme expressions) and how the client surfaces them.
- Privacy posture: exactly what leaves the browser, what the backend sees, what persists where, for how long.
