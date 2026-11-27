# nvidia campaign: shared context

Every `prompts/finish/8NN-nvidia-*.md` work order (851 to 879) names this file in its first lines. Read it before step 0. CLAUDE.md overrides everything here.

The campaign builds on three.ws's NVIDIA Inception membership (accepted July 2026, announced 2026-07-20). Its orders (19 filed 2026-11-16, 870 to 879 added 2026-11-26 from [the showcase research](../../../docs/nvidia-showcase-research.md)) turn membership into things NVIDIA can see, verify and reshare: current NVIDIA models in every lane, NVIDIA acceleration technology moved from "under evaluation" to "running in production", OpenUSD and Omniverse interop, and a digital-human demo that survives a conference floor. **They are independent by design: all of them can run at the same time in separate chats.** No order waits on another, and no order may assume another has landed. If you notice work from a sibling order on disk, reuse it when it fits, but never require it.

## Facts every order needs

| Fact | Value / where |
|---|---|
| Membership record and wording | [docs/nvidia-inception.md](../../../docs/nvidia-inception.md) |
| Every NVIDIA surface, its gate and status | [docs/nvidia-visibility-map.md](../../../docs/nvidia-visibility-map.md) (day-0 adoption pattern, tagging table, member benefits, dead ends) |
| NVIDIA model map, one key for everything | [docs/nvidia-models.md](../../../docs/nvidia-models.md); `NVIDIA_API_KEY` (an `nvapi-` key) on `three-ws-api`; NIM at `https://integrate.api.nvidia.com/v1`, GenAI invoke at `https://ai.api.nvidia.com/v1/genai/...`, retrieval at `https://ai.api.nvidia.com/v1/retrieval/...`, Riva and A2F over NVCF gRPC `grpc.nvcf.nvidia.com:443` |
| Accelerated Apps Catalog kit and the technology-claim rule | [docs/nvidia-apps-catalog-listing.md](../../../docs/nvidia-apps-catalog-listing.md), section "NVIDIA technologies used". Product record filed 2026-10-25; product renamed **Forge: AI 3D Model Generator** on 2026-11-25 when NVIDIA App Publishing asked for the exact name (reply in [nvidia-apps-catalog-request.md](../../../docs/nvidia-apps-catalog-request.md#app-publishing-reply-2026-11-25)) |
| NGC listing (TRELLIS container) | [docs/nvidia-ngc-listing.md](../../../docs/nvidia-ngc-listing.md); its image validation is order [981](../../awaiting-owner/981-plan-nvidia-ngc-trellis-image-validation.md). Do not modify `workers/model-trellis/` from this campaign |
| New NIM release watch | [api/cron/free-model-audit.js](../../../api/cron/free-model-audit.js) pages `llm:nim-new-release` when a model id first appears |
| GPU fleet | `workers/model-*`, recount with `gcloud run services list --project aerial-vehicle-466722-p5 --format="csv[no-heading](metadata.name,region,spec.template.spec.nodeSelector)" \| grep -i accelerator`; per-job timings in the `forge_worker_stats` table ([migration](../../../api/_lib/migrations/20261111163000_forge_worker_stats.sql)); keep-warm in [api/cron/gpu-keepwarm.js](../../../api/cron/gpu-keepwarm.js) |
| GPU capacity traps | us-central1 L4 quota is fully held (quota 3); new or extra L4 lanes deploy to another region with quota (check `gcloud compute regions describe <region>` quotas first). Long model builds and test runs go through Cloud Build, not local docker, so they survive session teardown. `gcloud builds submit` needs `TMPDIR=/home/user/.cache/gcloud-tmp` because the root disk is nearly full. |
| Voice and digital-human stack | [api/_lib/a2f-nvidia.js](../../../api/_lib/a2f-nvidia.js), [src/voice/a2f-player.js](../../../src/voice/a2f-player.js), [api/_lib/tts-nvidia.js](../../../api/_lib/tts-nvidia.js), [api/asr.js](../../../api/asr.js), demo at `/demos/audio2face` ([public/demos/audio2face.html](../../../public/demos/audio2face.html)) |
| Public NVIDIA surfaces | `/nvidia` ([pages/nvidia/index.html](../../../pages/nvidia/index.html)), `/cosmos` ([api/cosmos.js](../../../api/cosmos.js), [docs/cosmos.md](../../../docs/cosmos.md)), `/tutorials/nvidia-3d-free`, the Inception member perk ([docs/nvidia-inception-perk.md](../../../docs/nvidia-inception-perk.md)), SimReady assets ([docs/simready-assets.md](../../../docs/simready-assets.md)) |
| Production host | Google Cloud Run, `us-central1`. As of 2026-11-26 `three-ws-api` is moving to project `three-ws` while every model and GPU service stays in `aerial-vehicle-466722-p5` (the new project's trial has no GPU quota) and is called by URL. Read [docs/ops/gcp-project-migration.md](../../../docs/ops/gcp-project-migration.md) for what runs where before any `gcloud` command, and pass `--project` and `--account` explicitly. Crons run in tick mode in `three-ws`: declare a cron in `vercel.json` and it fires with the deploy; never create a per-cron Scheduler job there. It all stays on GCP. |
| Partner value | Partnerships pay off through social amplification. NVIDIA's accounts reshare a partner when the partner's news is also NVIDIA's news: a named NVIDIA technology, live in a product, with a measured number. Every order should leave behind one such verifiable number. |

## Saying it correctly (binding on every UI string, doc, listing and post)

- "three.ws is a member of the NVIDIA Inception program" is the approved claim. Membership is a startup program, not a partnership, an investment or an endorsement.
- Never claim an Inception tier (Premier or otherwise), an Accelerated Apps Catalog listing, NGC publication, GTC Pavilion selection or any NVIDIA endorsement until NVIDIA states it in writing.
- **The technology-claim rule.** A NVIDIA technology may be named as "used" only when it runs in production for real traffic. Something built but not deployed is "under evaluation". When your order moves a technology into production, update the "NVIDIA technologies used" list in [docs/nvidia-apps-catalog-listing.md](../../../docs/nvidia-apps-catalog-listing.md) and [docs/nvidia-models.md](../../../docs/nvidia-models.md) with the evidence (service name, revision, measured number) and put "update the Inception portal product record" in the owner message. If it is not deployed by close-out, it stays "under evaluation".
- Use NVIDIA product names nominatively (NVIDIA TensorRT, NVIDIA Omniverse, NVIDIA Cosmos and so on). Never put an NVIDIA mark inside a three.ws product name. Use the Inception badge only per the co-marketing kit's guidelines.
- Never imply NVIDIA endorses $THREE, a coin or a trading surface. NVIDIA-facing copy stays technical: no token, price or monetization vocabulary.

## Protected Forge lanes and the spend cut (binding, added 2026-11-26)

These two owner decisions are newer than the orders in this campaign. Where an order's text disagrees with them, they win.

- **A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed.** Full rule and the dated list: [docs/ops/forge-protected-lanes.md](../../../docs/ops/forge-protected-lanes.md). Measure before touching any generation worker: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over 7 days is protected. The self-hosted TRELLIS lane (`trellis_selfhost`, `workers/model-trellis/`) is protected by name: on 2026-11-26 it finished 914 of 971 jobs in 7 days. The keyless text-to-image rung in `api/_mcp3d/text-to-image.js` is protected in position.
- **What that means for this campaign.** TensorRT, Triton, the Run:ai Model Streamer and any other acceleration work goes on a lane that is NOT protected, or on a new service beside the protected one. Never change a protected lane's worker code, container, weights loader, Cloud Run settings, request body, or its place in `api/_lib/forge-tiers.js`. A new or faster engine enters behind the working one (taken only after the working one has failed) or in shadow (measured, not served). Moving it ahead is the owner's decision, made on your measured numbers; put it in the owner message and do not apply it.
- **Spend cut of 2026-11-25.** The owner set 25 Cloud Run services to minimum instances 0 on purpose. Never raise a minimum-instance floor or add a keep-warm call to win a cold-start number. Any order text about "freeing L4 quota held by warm instances" is out of date: with floors at 0, the goal of cold-start work is a shorter first request for the user.
- **Design docs for orders 871 to 879** live in `docs/nvidia/builds/`, with the plan in `docs/nvidia/builds/README.md`. They are plans, not specs. The agent that finishes one of those orders updates its design doc and its row in the plan.
- **Cost goal of 2026-11-26.** The owner wants hosting cost as low as it can go with no loss to the product. Every new service scales to zero, has a maximum instance count, and its eval doc states the measured cost per request (GPU seconds times the Cloud Run rate) beside the quality numbers, so the owner can weigh a new engine on cost as well as quality.
- **If step 0 shows your order's target is itself protected:** pin it with tests, report the numbers, change no behavior, and pick the next unprotected target.

## Rules for running every order at once in one worktree

1. **Dev server port.** Never take port 3000. Run `npm run dev -- --port <3200 + NN> --strictPort` where `NN` is your order's last two digits (order 857 uses 3257).
2. **Shared hot files** (`data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `vercel.json`, `vite.config.js`, `docs/nvidia-models.md`, `docs/nvidia-apps-catalog-listing.md`, `pages/nvidia/index.html`, `api/_lib/env.js`, `package.json`): edit them LAST, re-read the file immediately before each edit, make small anchored `Edit` calls (never rewrite the whole file), and commit right after. If an edit fails because the file moved, re-read and redo it.
3. **Shared GPU workers.** Several orders touch `workers/model-*`. Edit only the worker your order names or selects in step 0, re-read every file before editing, and deploy with the worker's own documented command. Never redeploy a worker you did not change.
4. **Stage explicit paths only.** Never `git add -A` or `git add .`. Run `git diff --staged` before every commit; if a sibling's hunk is in your staged file, unstage it with `git restore --staged -p`.
5. **Migrations.** Name each new migration with a fresh UTC timestamp. Run `npm run db:status` before `npm run db:migrate` (it applies immediately, no dry run). Read the `self-unblock-playbook` skill's database row first.
6. **Tests.** Run your own suite (`npx vitest run tests/<yours>.test.js`) on every change and `npm test` once before close-out. A failure you did not cause gets one line in the report, not a detour.
7. **Generated files.** After appending to `data/changelog.json`, run `npm run build:pages` and stage what it regenerates.
8. **package.json scripts.** Add a script only if you need one, with an `nvidia:` or feature-specific prefix, via a small anchored edit.

## Owner gates (batch into ONE message at the end of your session)

`git push`, production deploys of `three-ws-api` (`npm run deploy:gcp:full`), Inception portal edits, emails to `inceptionprogram@nvidia.com`, NGC or Omniverse Exchange submissions, Brev account actions, NVIDIA Developer Forums or Discord posts, and posts on X or LinkedIn are owner steps. Build and verify everything up to the step, write the exact click path, command or paste-ready text into the repo, and list it in your final owner message. Never contact NVIDIA or any third party yourself.

GPU worker deploys are Cloud Run service updates inside the pre-approved GCP project: deploy a worker your order changed when its own runbook says to, verify it, and record the revision. A worker deploy that would shift production traffic away from a healthy lane goes behind a flag or a canary percentage first.

## Paid services

GCP is pre-approved (Cloud Run GPU, Cloud Build, Vertex AI, storage). The NVIDIA hosted APIs behind `NVIDIA_API_KEY` are already in use and free on our account; adding a new model on that same key is not a new paid API. Do not onboard a new paid third-party service (DGX Cloud Lepton, a paid NIM license, a new SaaS) without owner approval: build it behind an env var, prove it against the vendor's live endpoint (a documented auth error counts), and list the missing variable in the owner message. Self-hosting an NVIDIA container that requires an NVIDIA AI Enterprise production license is an owner decision; evaluation use under the NVIDIA Developer Program terms is fine and must be labelled as evaluation.

## Progress log

Append a dated entry to [nvidia-PROGRESS.md](nvidia-PROGRESS.md) when you finish: order number, commit SHAs, what is live, the measured number, what waits on the owner. Re-read the log right before appending (siblings write to it too) and append with a small anchored edit at the end.
