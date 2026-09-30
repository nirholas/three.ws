# three.ws 30-day proof brief: October 2026 issue

**Window:** 2026-08-31 to 2026-09-30 (31 days). **Data pulled:** 2026-09-30 08:24 UTC, so the
last day is partial. **Regenerate:** `npm run partners:proof -- --from 2026-08-31 --to 2026-09-30`
(add `--json` for the raw report, `--mcp-logs` for the Cloud Logging census).

This is the evidence sheet the [distribution and co-marketing plan](./openai-ibm-nvidia-growth-plan.md)
scheduled for October 14. Every number below was read from production (Neon, Cloud Run,
Cloud Monitoring, the Cloud Billing catalog, npm, GitHub) by
[`scripts/partner-proof-brief.mjs`](../../scripts/partner-proof-brief.mjs), and the query behind
each one is listed in the [source key](#source-key). Nothing is projected, sampled, or rounded
up. Where a number is weak or was not measurable, the brief says so instead of leaving it out.

---

## Headline metrics

| # | Metric | Value | Source |
|---|---|---|---|
| 1 | 3D generation and rigging requests from real makers | **12,373** requests, **7,111** finished models | Q1 |
| 2 | Completion rate, normal operation (19 of 31 days) | **90.2%** (5,486 of 6,085) | Q1 daily |
| 3 | Completion rate, last 5 days after recovery (Sep 26 to 30) | **87.0%** (1,357 of 1,560) | Q1 daily |
| 4 | Completion rate, whole window including two incident windows | **57.5%** (7,111 of 12,367 terminal) | Q1 |
| 5 | Distinct makers | **7,613** browsers from **1,988** network origins; **215** signed-in | Q1 |
| 6 | Successful meshes produced by the GPU fleet (all origins) | **19,270** on self-hosted GPUs (11,247 L4 TRELLIS, 5,355 RTX PRO 6000 Hunyuan3D, 2,578 rigs, 90 TripoSG) | Q3 |
| 7 | GPU services live on Cloud Run | **12** GPU services; **6** carried the month: 5 on NVIDIA L4, 1 on NVIDIA RTX PRO 6000 Blackwell; **3,893** billable GPU instance hours | G1, G2 |
| 8 | Median job latency, RTX PRO 6000 lane (maker requests, Sep 24 to 30) | **p50 135 s, p95 304 s** (n = 572) | Q2 |
| 9 | Median job latency, L4 TRELLIS lane (fleet, full window) | **p50 124 s, p95 325 s** (n = 9,552) | Q4 |
| 10 | GPU cost per successful output at Cloud Run list price | **$0.18** L4 TRELLIS, **$0.44** RTX PRO 6000 Hunyuan3D, **$0.30** rigging | G1 to G3, Q3 |
| 11 | MCP tool calls | **13,898** at **99.4%** handler success; handler p50 **143 ms** | Q5 |
| 12 | MCP client names that registered over OAuth | **13**, including our own CLI (Antigravity, Claude, ChatGPT, Codex, Cursor, Claude Code, Glama, ZCode, and others) | Q6 |
| 13 | NVIDIA NIM inference calls | **88,431** calls, **138.4M** tokens (Nemotron 3 Super p50 **1.7 s**) | Q7 |
| 14 | Agents created by people | **727** agents by **415** owners (**323** published, **725** with a 3D body) | Q8 |
| 15 | Avatars created by people | **703** (322 studio, 154 selfie reconstruction, 72 forge, 69 import, 86 other) | Q9 |
| 16 | Signups and active accounts (people only) | **412** signups, **453** active | Q10 |
| 17 | npm downloads, `@three-ws` scope | **25,312** across **106** packages | P1 |
| 18 | GitHub | **219** stars, **52** forks (**26** forks created in the window) | P2 |

Every people-count excludes the platform's own seed crons (43,376 seeded avatars and their
machine accounts), QA logins, and synthetic test registrations. Every forge count excludes
catalog-seeder and internal benchmark rows, and folds a failed-over attempt into the successor
row that finished the request. Those rules are the same ones the owner dashboards use
(`api/_lib/forge-funnel.js`).

---

## What the month actually looked like

The completion rate is the number every partner will ask about, so here is the whole shape.

| Period | Days | Requests | Finished | Completion |
|---|---|---|---|---|
| Normal operation | 19 | 6,085 | 5,486 | **90.2%** |
| Rigging incident, Sep 11 to 15 | 5 | 3,936 | 1,297 | 33.0% |
| Generation incident, Sep 19 to 25 | 7 | 2,352 | 328 | 13.9% |
| Recovered, Sep 26 to 30 | 5 | 1,560 | 1,357 | **87.0%** |

(The recovered rows are a subset of normal operation; the three windows above them partition
the month.)

Two failures account for most of the lost requests, and both are worker-side, not model-side:

1. **Rigging, Sep 11 to 15:** 2,346 rig jobs failed with `task not found on gcp service`: the
   rig worker's task records stopped resolving when polled, during a burst of about 500 rig
   requests a day (3,176 rig requests from Sep 10 to 15, from 138 network origins). Rigging
   completed 98.6% of requests on Sep 16 to 18.
2. **Generation, Sep 19 to 25:** the TRELLIS worker served an image built before its system
   library fix (`35d798585`) and its jobs were orphaned (1,251 failures, `no progress within 30
   minutes`), while the Hunyuan3D worker returned `pipeline unavailable` (899 failures). TRELLIS
   traffic was rolled back to the last good revision on Sep 29 (recorded in the
   [ChatGPT resubmission checklist](../../prompts/store-submissions/_generated/openai-submission.md)),
   and it finished 58 of 66 jobs on Sep 30. From Sep 26, once Hunyuan3D recovered, the router
   sent most generation to the RTX PRO 6000 lane, which finished 544 of 621 requests on Sep 26
   to 29 while TRELLIS was still down. The last full day, Sep 29, finished 91.6%.

Automatic failover recovered **810** failed attempts on another lane before the maker saw a
failure (478 from TRELLIS, 332 from Hunyuan3D); those are already folded into the numbers above.

**How to quote it:** "90% completion in normal operation, 87% over the last five days, with two
worker incidents in September that we root-caused and fixed." Do not quote 90% as a monthly
figure; the monthly figure is 57.5%.

---

## OpenAI: interactive 3D creation inside ChatGPT

**Lead story:** turn a plain-language request into a textured, downloadable 3D asset and inspect
it in an interactive viewer without leaving ChatGPT.

**Verified proof:**

- **1,723 tool calls** reached the two ChatGPT-facing MCP servers with **zero errors**:
  `mcp-studio` 1,534 (the Apps SDK connector) and `mcp-chatgpt` 189. Top tools: `forge_free`
  467, `check_job` 450, `forge_avatar` 242, `look_at_model` 200, `mesh_forge` 188. Other MCP
  clients can also connect to `mcp-studio`, so this is an upper bound on ChatGPT-originated
  calls. (Q5)
- **ChatGPT completed OAuth against three.ws:** 1 client registration, 7 token grants, 2
  accounts. Codex added 26 grants for 2 accounts. (Q6)
- **Generated GLB examples from inside ChatGPT:** the telescope and robot mascot in the
  [gallery](#example-gallery) were made through the ChatGPT connector on Sep 28 and load
  publicly today.
- **Viewer UX:** every finished model opens in the three.ws viewer at `https://three.ws/m/<id>`,
  and ships a web-optimized GLB (meshopt, 270 to 880 KB for the gallery models) beside the full
  file.

**Say plainly:** the ChatGPT app is still in review, so this is developer-mode and review
traffic, not directory installs. The installs number OpenAI will want arrives after listing.
The honest ask today is the Developer Showcase, with this brief as the evidence.

---

## IBM: governed enterprise agents gaining 3D capabilities through Remote MCP

**Lead story:** add production 3D generation and digital-human capabilities to governed
enterprise agent workflows through a Remote MCP server with standard OAuth.

**Verified proof:**

- **The Remote MCP surface is production-grade by the numbers:** 13,898 tool calls across the
  three.ws MCP servers at **99.4%** handler success, p50 **143 ms** for the non-generative tools.
  Of the 89 errors, 85 are the Granite tools described below. (Q5)
- **Auth works with the clients enterprise developers already use:** 13 client names
  registered through OAuth dynamic client registration in the window (12 besides our own
  CLI), including Antigravity (149 registrations), Claude (19), Glama (5), Cursor, Codex, and
  ChatGPT. Claude, Codex, ChatGPT, Grok, and Claude Code were issued tokens for signed-in
  accounts (Claude alone: 50 grants to 4 accounts). (Q6)
- **Deployment:** one Cloud Run service (`three-ws-api`, us-central1) serves every MCP endpoint;
  the IBM listing endpoint is `https://three.ws/api/mcp-3d`.
- **Workflow value is real volume:** 7,111 finished 3D models and 727 agents created by people in
  the window are the capabilities an Orchestrate agent would call.

**Blocker to fix before the IBM pitch:** the Granite and watsonx tools are down. All 17 Granite
health checks in the window failed, the last watsonx response was **2026-08-07**, and all 85
Granite tool calls failed with `WATSONX_API_KEY is not set`. `WATSONX_API_KEY` and
`WATSONX_PROJECT_ID` are absent from the `three-ws-api` service, `.env`, and `.env.local`. Until
the owner restores them, do not claim a working Granite or watsonx integration in any IBM
material; lead with Remote MCP, OAuth, and deployment. (Q11)

Also say plainly: `/api/mcp-3d` itself served only 7 authenticated tool calls in the window
(its traffic is discovery from directories and crawlers). The listing is ready; enterprise
usage starts with the Agent Connect listing.

Framing rules from [`docs/ibm.md`](../ibm.md) apply: "three.ws is an IBM Business Partner," no
implied endorsement, and the Granite tools are three.ws-built integrations.

---

## NVIDIA: GPU-accelerated 3D and browser digital humans

**Lead story:** a browser-native digital-human and 3D generation stack running across NVIDIA
L4 and RTX PRO 6000 Blackwell on Cloud Run, with NIM-hosted models.

**Verified proof:**

| GPU lane | Accelerator | Billable hours | Successful outputs | p50 / p95 | List cost per success |
|---|---|---|---|---|---|
| Hunyuan3D 2.1 (`model-hunyuan3d-21-rtx`) | RTX PRO 6000 Blackwell | 733 | 5,355 | 135 s / 304 s (makers, Sep 24 to 30) | **$0.44** |
| TRELLIS (`model-trellis`, 2 regions) | L4 | 1,446 | 11,247 | 124 s / 325 s (fleet, full window) | **$0.18** |
| Auto-rig (`model-rig`) | L4 | 728 | 2,578 | 62 s / 75 s (makers, Sep 24 to 30) | **$0.30** (upper bound) |
| TripoSG sketch (`model-triposg`) | L4 | 458 | 90 | 108 s / 337 s (makers, Sep 24 to 30) | $7.22 (idle-dominated) |
| Text to motion (`model-text2motion`, us-east4) | L4 | 525 | not in forge ledger | not measured | not measured |

- **NIM-hosted inference at volume:** 88,431 calls and 138.4M tokens through NVIDIA's hosted
  API. Nemotron 3 Super 120B served 73,571 reasoning calls at p50 1.7 s, p95 4.7 s; Llama 3.2
  11B Vision on NIM served 14,346 model-QA calls at p50 5.2 s, p95 16.3 s. (Q7)
- **NIM-hosted 3D:** the free NVIDIA NIM TRELLIS lane took 502 attempts and finished 398
  (79.3%). (Q2)
- **Warm capacity is the honest lever:** four of the six working services are pinned warm
  (minimum one instance), so each bills about 730 hours a month whether it is busy or not.
  Most of the $6,356 list-price month is that warm time, so cost per output falls as volume
  grows. The RTX PRO 6000 service averaged 7.3 successful meshes per billable hour; the two L4
  TRELLIS services together averaged 7.8. (G1, G2, Q3)

**Not measured this month:** Riva speech and Audio2Face facial animation have no per-call
ledger, so only request counts from Cloud Logging are available (see caveats). Record a
Riva/Audio2Face latency and completion series before the Startup Showcase pitch.

Use "three.ws is a member of NVIDIA Inception." Never "NVIDIA partner."

---

## Example gallery

All five were generated by real makers inside the window, are public, and were verified live
on 2026-09-30: each viewer page returns 200 and each GLB starts with the `glTF` magic bytes and
parses cleanly.

| Model | Made through | Lane and GPU | Geometry | Viewer | GLB |
|---|---|---|---|---|---|
| Vintage brass telescope on a walnut tripod | ChatGPT connector, Sep 28 | Hunyuan3D 2.1, RTX PRO 6000; finished in 66 s | 30,000 triangles, 4 textures | [open](https://three.ws/m/e3521803-4188-49e3-a4ce-30c57cc3e28a) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/anon/e3521803-4188-49e3-a4ce-30c57cc3e28a.web.glb) |
| Friendly round robot mascot | ChatGPT connector, Sep 28 | Hunyuan3D 2.1, RTX PRO 6000; finished in 34 s | 30,000 triangles, 4 textures | [open](https://three.ws/m/a73fc6e6-9213-42f9-80e4-7a73f1225c4a) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/anon/a73fc6e6-9213-42f9-80e4-7a73f1225c4a.web.glb) |
| Smoky quartz crystals on raw rock | three.ws Forge, Sep 4 | TRELLIS, L4 | 15,812 triangles | [open](https://three.ws/m/fe7f4f97-4839-4e00-92a5-48675055fca7) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/7bd4a885f026/fe7f4f97-4839-4e00-92a5-48675055fca7.web.glb) |
| Weathered leather-bound book (kept and downloaded by its maker) | three.ws Forge, Sep 3 | TRELLIS, L4 | 16,452 triangles | [open](https://three.ws/m/324c1a62-9cb8-45d9-ac80-60152eb56ea7) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/06b7f9884f2c/324c1a62-9cb8-45d9-ac80-60152eb56ea7.web.glb) |
| Chibi anime character, full body | three.ws Forge, Sep 25 | NVIDIA NIM-hosted TRELLIS | 6,111 triangles, 3 textures | [open](https://three.ws/m/c30f9cc9-28a4-49be-a9cb-81920d6a7983) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/44778bb376d3/c30f9cc9-28a4-49be-a9cb-81920d6a7983.web.glb) |

Per partner: lead OpenAI with the telescope and robot (made inside ChatGPT), NVIDIA with the
telescope (Blackwell) and quartz (L4), IBM with any of them as the "what your agent gets back"
slide. Screenshot the viewer page, not the raw GLB. For the next issue,
`npm run partners:proof` lists fresh candidates with their files checked live.

---

## Caveats

- **Completion rate:** 57.5% for the month; 90.2% in normal operation. Both incidents are
  described above. The rigging burst on Sep 10 to 15 used 3,109 browser keys from only 138
  network origins, so the rig failure count overstates how many people were affected.
- **Latency coverage:** maker-request latency is stamped only since Sep 24 (the
  `completed_at` column landed then), so full-window latency for the self-hosted lanes comes
  from the catalog seeder, which drives the same GPU workers and includes a quality-gate render
  after the mesh. The NIM lane's recorded time excludes the synchronous NIM call, so no NIM 3D
  latency is quoted.
- **Cost:** cost per output is Cloud Run **list price** (Cloud Billing catalog SKUs for L4 and
  RTX PRO 6000 without zonal redundancy, plus instance-based vCPU and memory) multiplied by
  Cloud Monitoring `billable_instance_time`, divided by every successful mesh on that lane
  including seeder output. The invoice is covered by Google for Startups credits and was not
  read: BigQuery billing export is not finished (see `docs/ops/gcp-credits-plan.md`). The
  rigging figure is an upper bound because seeder rigs share the worker and are not in the
  denominator. The us-east4 TRELLIS copy is a warm standby and is counted in the TRELLIS cost.
- **Makers:** 7,613 is distinct browser keys, which automated callers can rotate; 1,988
  distinct network origins is the conservative floor. Only 143 finished models were explicitly
  kept or downloaded, because feedback is optional; do not quote a satisfaction rate.
- **MCP distinct clients:** tool calls on the free MCP tools are anonymous, so "distinct
  clients" is measured as OAuth client names (13, one of them our own CLI), not as unique end
  users.
- **npm:** download counts include mirrors and automated installs. The flat distribution
  (median 223 per package across 106 packages) says most of it is registry-wide background
  traffic, so quote the total only next to the most-downloaded packages: `@three-ws/avatar` 715,
  `@three-ws/vision-mcp` 502, `@three-ws/avatar-mcp` 419, `@three-ws/mcp-server` 407,
  `@three-ws/ibm-watsonx-mcp` 372, `@three-ws/scene-mcp` 363.
- **GitHub stars in the window:** not measured. GitHub serves star timestamps only to
  authenticated callers and no token exists on this machine or the service. Run the script with
  `GITHUB_TOKEN` set to fill it in.
- **Embeds:** weak and not pitchable yet. 18 widgets were created and viewed 173 times, all but
  one view on three.ws itself.
- **Paid usage:** not a proof point this month. Of 62,188 x402 receipts in the window, 62,170
  were paid by the platform's own settlement wallets; 18 receipts from 4 outside payers remain.
- **Riva and Audio2Face:** no per-call ledger exists, so there is no completion or latency series
  for them yet.

---

## Before this goes to a partner

1. Restore `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on `three-ws-api` (owner-held IBM
   credentials), then confirm a green `granite_inference_health` check. Required for the IBM
   pitch.
2. Rebuild `model-trellis` from `workers/model-trellis/cloudbuild.yaml` and send traffic to
   latest, so the lane that produced most of the month's meshes is on a current image.
3. Re-run `npm run partners:proof` on the send date and update any number that moved.
4. Pick three metrics per partner from the tables above: OpenAI (rows 11, 12, gallery),
   IBM (rows 11, 12, 1), NVIDIA (rows 7, 8, 10).

---

## Source key

All database queries are read-only SELECTs against production Neon with
`$1 = '2026-08-31T00:00:00Z'` and `$2 = '2026-10-01T00:00:00Z'`. The script holds the exact
text; these are the definitions.

- **Q1 forge requests:** `forge_creations fc` where `created_at` in window, `internal = false`,
  no matching `forge_seed_jobs.creation_id`, and `superseded_by is null`. Completion is
  `done / (done + failed)`. Rig rows are `prompt = 'auto-rig'` with no backend.
- **Q2 lanes:** the same rows without the `superseded_by` filter, grouped by backend. Latency is
  `percentile_cont(completed_at - created_at)` over `status = 'done'`.
- **Q3 outputs, all origins:** `count(*) filter (where status = 'done')` from `forge_creations` in
  window, grouped by backend, internal and seeder rows included.
- **Q4 fleet latency:** `percentile_cont(finished_at - started_at)` from `forge_seed_jobs` in
  window, grouped by backend and status.
- **Q5 MCP:** `usage_events` where `kind = 'tool_call'`, grouped by `meta->>'server'`; success is
  `status is distinct from 'error'`; latency is `latency_ms`.
- **Q6 OAuth clients:** `oauth_clients.name` created in window, excluding names matching
  `probe|test|poc-|security|sec-`; grants are `oauth_refresh_tokens` joined on `client_id`.
- **Q7 NVIDIA inference:** `usage_events` where `provider = 'nvidia'`, grouped by `kind` and
  `model`, tokens are `input_tokens + output_tokens`.
- **Q8 agents, Q9 avatars, Q10 people:** `agent_identities`, `avatars`, `users` and `sessions`
  joined to `users u` with `not u.service_account` and QA/test email patterns excluded.
- **Q11 Granite:** `granite_inference_health` and `usage_events` where
  `meta->>'server' = 'mcpibm'`.
- **G1 fleet:** `gcloud run services list --format=json`, GPU from
  `spec.template.spec.nodeSelector['run.googleapis.com/accelerator']`.
- **G2 hours:** Cloud Monitoring `run.googleapis.com/container/billable_instance_time`, summed
  per service and region over the window.
- **G3 prices:** Cloud Billing Catalog API, Cloud Run SKUs `NVIDIA L4 GPU with no zonal
  redundancy`, `NVIDIA RTX Pro 6000 GPU with no zonal redundancy`, `Services CPU
  (Instance-based billing)`, `Services Memory (Instance-based billing)` for each region.
- **P1 npm:** `registry.npmjs.org/-/org/three-ws/package`, then
  `api.npmjs.org/downloads/point/2026-08-31:2026-09-30/<package>` for each `@three-ws/*` name.
- **P2 GitHub:** `api.github.com/repos/nirholas/three.ws` and its `/forks` list.
